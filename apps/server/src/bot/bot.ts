import { Bot } from 'grammy';

export function createBot(
  token: string,
  handle: (msg: { chatId: number; text: string }) => Promise<string | null>,
): Bot {
  const bot = new Bot(token);

  // /id funciona em qualquer chat, mesmo não cadastrado (necessário para o setup)
  bot.command('id', (ctx) => ctx.reply(`chat_id: ${ctx.chat.id}`));

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
