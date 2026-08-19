import { getConfig } from './lib/config.js';
import { createBudgetAlert } from './lib/alerts.js';
import { supabase } from './db/client.js';
import { getState, setState } from './db/state.js';
import { defaultAgentDeps, handleMessage } from './agent/agent.js';
import { createBot } from './bot/bot.js';
import { saveKnowledgeDocument } from './knowledge/document.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWebServer } from './api/server.js';
import { Bot } from 'grammy';
import { telegramDeliveryConfig } from './lib/telegram-delivery.js';

async function main() {
  const cfg = getConfig();

  const bot = createBot(
    cfg.TELEGRAM_TOKEN,
    (msg) => handleMessage(msg, agentDeps),
    (msg) => saveKnowledgeDocument(msg),
  );
  // O Hermes mantém o long polling do bot novo. Aqui criamos somente um cliente
  // de envio com o mesmo token; chamadas sendMessage não disputam as atualizações.
  const delivery = telegramDeliveryConfig(cfg);
  const deliveryBot = delivery.token === cfg.TELEGRAM_TOKEN ? bot : new Bot(delivery.token);

  const sendToLuis = async (text: string) => {
    const { data } = await supabase
      .from('users')
      .select('telegram_chat_id')
      .eq('subject', 'luis')
      .maybeSingle();
    if (data) await deliveryBot.api.sendMessage(Number(data.telegram_chat_id), text);
  };
  const agentDeps = defaultAgentDeps(createBudgetAlert({ send: sendToLuis, getState, setState }));

  startScheduler(deliveryBot, {
    interactionMode: delivery.interactionMode,
  });
  startWebServer(cfg);
  if (!cfg.TELEGRAM_LISTENER_ENABLED) {
    console.log('[bot] listener antigo desativado; rotinas serão entregues pelo bot do Hermes');
    return;
  }
  console.log('[bot] iniciando long polling…');
  await bot.start();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
