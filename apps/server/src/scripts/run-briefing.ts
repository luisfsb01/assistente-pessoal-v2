// Roda o briefing matinal manualmente (uso: npm run job:briefing -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runDailyBriefing } from '../jobs/briefing.js';
import { telegramDeliveryConfig } from '../lib/telegram-delivery.js';

const delivery = telegramDeliveryConfig(getConfig());
const bot = new Bot(delivery.token);
await runDailyBriefing(
  (chatId, text, kb) => bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
  undefined,
  delivery.interactionMode,
);
console.log('briefing executado');
