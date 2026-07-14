import { Bot } from 'grammy';
import { confirmTransaction, getTransactionById, learnRule } from '../db/finance.js';
import { decodeAction } from './callback.js';

export function createBot(
  token: string,
  handle: (msg: { chatId: number; text: string }) => Promise<string | null>,
): Bot {
  const bot = new Bot(token);

  // /id funciona em qualquer chat, mesmo não cadastrado (necessário para o setup)
  bot.command('id', (ctx) => ctx.reply(`chat_id: ${ctx.chat.id}`));

  // Botão ✅ da revisão diária de gastos: confirma na categoria mostrada e aprende a regra.
  bot.on('callback_query:data', async (ctx) => {
    try {
      const action = decodeAction(ctx.callbackQuery.data);
      if (!action) return void (await ctx.answerCallbackQuery());
      const ok = await confirmTransaction(action.txId);
      await ctx.answerCallbackQuery({ text: ok ? 'Confirmado ✅' : 'Não encontrada' });
      if (!ok) return;
      await ctx.editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Gasto confirmado'}`);
      // confirmar = endossar a categoria mostrada → aprende a regra (nunca quebra o fluxo)
      try {
        const tx = await getTransactionById(action.txId);
        if (tx?.category_id) await learnRule(tx.description, tx.category_id);
      } catch (err) {
        console.error('[bot] fin confirm: learnRule falhou:', err);
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
      const reply = await handle({ chatId: ctx.chat.id, text });
      if (reply) await ctx.reply(reply); // null = chat não cadastrado → ignora em silêncio
    } catch (err) {
      console.error('[bot]', err);
      await ctx.reply('Tive um problema aqui do meu lado. Tenta de novo?').catch(() => {});
    }
  });

  bot.catch((err) => console.error('[bot:unhandled]', err));
  return bot;
}
