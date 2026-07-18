import { Bot } from 'grammy';
import {
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  type IncomingKnowledgeDocument,
} from '../knowledge/document.js';
import { confirmTransaction, getTransactionById, learnRule } from '../db/finance.js';
import { getChatIdentity, getUserBySubject } from '../db/chats.js';
import { getHabitById } from '../db/habits.js';
import { moveProjectTask } from '../db/projects.js';
import { deleteTravelList } from '../db/lists.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { registerHabitAnswer, sendNextCheckinQuestion } from '../jobs/daily-checkin.js';
import { decodeAction } from './callback.js';

export function createBot(
  token: string,
  handle: (msg: { chatId: number; senderId?: number; text: string }) => Promise<string | null>,
  handleDocument: (msg: IncomingKnowledgeDocument) => Promise<string | null>,
): Bot {
  const bot = new Bot(token);

  // /id funciona em qualquer chat, mesmo não cadastrado (necessário para o setup)
  bot.command('id', (ctx) => ctx.reply(`chat_id: ${ctx.chat.id}`));

  // Botão ✅ da revisão diária de gastos: confirma na categoria mostrada e aprende a regra.
  // Botões de hábito/tarefa vencida: check-in das 21:00.
  bot.on('callback_query:data', async (ctx) => {
    try {
      const chatId = ctx.chat?.id;
      const identity = chatId === undefined ? null : await getChatIdentity(chatId, ctx.from.id);
      if (!identity) {
        await ctx.answerCallbackQuery({ text: 'Não autorizado.' });
        return;
      }
      const action = decodeAction(ctx.callbackQuery.data);
      if (!action) return void (await ctx.answerCallbackQuery());

      if (action.kind === 'fin') {
        if (identity.kind !== 'private' || identity.subject !== 'luis') {
          await ctx.answerCallbackQuery({ text: 'Não autorizado.' });
          return;
        }
        const ok = await confirmTransaction(action.txId);
        await ctx.answerCallbackQuery({ text: ok ? 'Confirmado ✅' : 'Não encontrada' });
        if (!ok) return;
        await ctx
          .editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Gasto confirmado'}`)
          .catch(() => {});
        try {
          const tx = await getTransactionById(action.txId);
          if (tx?.category_id) await learnRule(tx.description, tx.category_id);
        } catch (err) {
          console.error('[bot] fin confirm: learnRule falhou:', err);
        }
        return;
      }

      if (action.kind === 'hab') {
        if (!identity?.subject || chatId === undefined) return void (await ctx.answerCallbackQuery());
        const today = todayInTz(getConfig().TIMEZONE);
        const result = await registerHabitAnswer(action.habitId, action.done, today);
        await ctx.answerCallbackQuery({ text: result === 'repetido' ? 'Já registrado' : action.done ? 'Feito ✅' : 'Anotado' });
        if (result === 'repetido') return;
        const habit = await getHabitById(action.habitId);
        await ctx
          .editMessageText(`${action.done ? '✅' : '❌'} ${habit?.name ?? 'Hábito'} — ${action.done ? 'feito hoje' : 'hoje não'}`)
          .catch(() => {});
        if (result === 'novo') {
          const user = await getUserBySubject(identity.subject);
          if (user)
            await sendNextCheckinQuestion(user.id, chatId, (cid, text, kb) =>
              bot.api.sendMessage(cid, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
            );
        }
        return;
      }

      if (action.kind === 'travel') {
        if (identity.kind !== 'group') {
          await ctx.answerCallbackQuery({ text: 'Não autorizado.' });
          return;
        }
        if (action.action === 'delete') {
          const deleted = await deleteTravelList(action.listId);
          await ctx.answerCallbackQuery({ text: deleted ? 'Lista apagada 🗑️' : 'Lista não encontrada' });
          await ctx
            .editMessageText(
              deleted
                ? `🗑️ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Lista de viagem apagada'}`
                : 'Essa lista de viagem já foi apagada.',
            )
            .catch(() => {});
        } else {
          await ctx.answerCallbackQuery({ text: 'Lista mantida 📌' });
          await ctx
            .editMessageText(`📌 ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Lista de viagem'} — mantida`)
            .catch(() => {});
        }
        return;
      }

      // ptask: tarefa de projeto vencida do check-in
      if (identity.kind !== 'private' || !identity.subject) {
        await ctx.answerCallbackQuery({ text: 'Não autorizado.' });
        return;
      }
      if (action.action === 'done') {
        await moveProjectTask(action.taskId, 'done');
        await ctx.answerCallbackQuery({ text: 'Concluída ✅' });
        await ctx
          .editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Tarefa concluída'}`)
          .catch(() => {});
      } else {
        await ctx.answerCallbackQuery({ text: 'Ok, segue pendente' });
        await ctx
          .editMessageText(`⏳ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Tarefa'} — segue pendente`)
          .catch(() => {});
      }
    } catch (err) {
      console.error('[bot:callback]', err);
      await ctx.answerCallbackQuery({ text: '❌ Erro, tenta de novo.' }).catch(() => {});
    }
  });

  bot.on('message:text', async (ctx) => {
    // no grupo, prefixa quem falou para o agente (e a reflexão) saberem
    const text =
      ctx.chat.type === 'private'
        ? ctx.message.text
        : `${ctx.from?.first_name ?? 'Alguém'}: ${ctx.message.text}`;
    try {
      await ctx.replyWithChatAction('typing');
      const reply = await handle({ chatId: ctx.chat.id, senderId: ctx.from.id, text });
      if (reply) await ctx.reply(reply); // null = chat não cadastrado → ignora em silêncio
    } catch (err) {
      console.error('[bot]', err);
      await ctx.reply('Tive um problema aqui do meu lado. Tenta de novo?').catch(() => {});
    }
  });

  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    try {
      await ctx.replyWithChatAction('typing');
      const reply = await handleDocument({
        chatId: ctx.chat.id,
        senderId: ctx.from.id,
        fileName: document.file_name,
        mimeType: document.mime_type,
        fileSize: document.file_size,
        download: async () => {
          const file = await ctx.api.getFile(document.file_id);
          if (!file.file_path) throw new Error('Telegram não retornou o caminho do documento.');
          const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`Download do Telegram falhou: HTTP ${res.status}`);
          const announced = Number(res.headers.get('content-length') ?? 0);
          if (announced > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
            return new Uint8Array(MAX_KNOWLEDGE_DOCUMENT_BYTES + 1);
          }
          return new Uint8Array(await res.arrayBuffer());
        },
      });
      if (reply) await ctx.reply(reply);
    } catch (err) {
      console.error('[bot:document]', err);
      await ctx.reply('Não consegui baixar ou salvar esse arquivo. Tenta de novo?').catch(() => {});
    }
  });

  bot.catch((err) => console.error('[bot:unhandled]', err));
  return bot;
}
