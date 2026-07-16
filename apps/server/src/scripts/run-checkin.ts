// Roda o check-in das 21:00 manualmente (uso: npm run job:checkin -w apps/server)
import { Bot } from 'grammy';
import { runDailyCheckin } from '../jobs/daily-checkin.js';
import { getConfig } from '../lib/config.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
await runDailyCheckin((chatId, text, kb) =>
  bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
);
console.log('check-in enviado (se havia pendências)');
