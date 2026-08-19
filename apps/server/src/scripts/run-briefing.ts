// Roda o briefing matinal manualmente (uso: npm run job:briefing -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runDailyBriefing } from '../jobs/briefing.js';
import { telegramDeliveryConfig } from '../lib/telegram-delivery.js';

const bot = new Bot(telegramDeliveryConfig(getConfig()).token);
await runDailyBriefing((chatId, text) => bot.api.sendMessage(chatId, text).then(() => undefined));
console.log('briefing executado');
