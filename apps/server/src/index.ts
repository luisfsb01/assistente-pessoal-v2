import { getConfig } from './lib/config.js';
import { createBudgetAlert } from './lib/alerts.js';
import { supabase } from './db/client.js';
import { getState, setState } from './db/state.js';
import { defaultAgentDeps, handleMessage } from './agent/agent.js';
import { createBot } from './bot/bot.js';
import { startScheduler } from './jobs/scheduler.js';

async function main() {
  const cfg = getConfig();

  const bot = createBot(cfg.TELEGRAM_TOKEN, (msg) => handleMessage(msg, agentDeps));

  const sendToLuis = async (text: string) => {
    const { data } = await supabase
      .from('users')
      .select('telegram_chat_id')
      .eq('subject', 'luis')
      .maybeSingle();
    if (data) await bot.api.sendMessage(Number(data.telegram_chat_id), text);
  };
  const agentDeps = defaultAgentDeps(createBudgetAlert({ send: sendToLuis, getState, setState }));

  startScheduler();
  console.log('[bot] iniciando long polling…');
  await bot.start();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
