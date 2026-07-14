// Roda um ciclo completo de proatividade (uso: npm run job:proactive -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runProactiveCycle } from '../proactive/engine.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
const out = await runProactiveCycle(['finance', 'calendar', 'tasks'], (chatId, text) =>
  bot.api.sendMessage(chatId, text).then(() => undefined),
);
console.log(`ciclo: ${out.collected} coletados, ${out.judged} julgados, ${out.notified} notificados`);
