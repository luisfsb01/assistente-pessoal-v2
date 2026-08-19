// Roda a revisão financeira manualmente (uso: npm run job:finance -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runFinanceReview } from '../jobs/finance-review.js';
import { telegramDeliveryConfig } from '../lib/telegram-delivery.js';

const delivery = telegramDeliveryConfig(getConfig());
const bot = new Bot(delivery.token);
await runFinanceReview(bot, { interactionMode: delivery.interactionMode });
console.log('revisão financeira executada');
