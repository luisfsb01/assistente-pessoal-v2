// Roda a revisão financeira manualmente (uso: npm run job:finance -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runFinanceReview } from '../jobs/finance-review.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
await runFinanceReview(bot);
console.log('revisão financeira executada');
