// Roda o check-in das 21:00 manualmente (uso: npm run job:checkin -w apps/server)
import { Bot } from 'grammy';
import { runDailyCheckin } from '../jobs/daily-checkin.js';
import { getConfig } from '../lib/config.js';
import { telegramDeliveryConfig } from '../lib/telegram-delivery.js';

const delivery = telegramDeliveryConfig(getConfig());
const bot = new Bot(delivery.token);
await runDailyCheckin((chatId, text, kb) =>
  bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
  undefined,
  delivery.interactionMode,
);
console.log('check-in enviado (se havia pendências)');
