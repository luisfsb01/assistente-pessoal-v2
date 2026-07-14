import cron from 'node-cron';
import type { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runReflection } from '../memory/reflection.js';
import { runFinanceReview } from './finance-review.js';

export function startScheduler(bot: Bot): void {
  const cfg = getConfig();
  cron.schedule(
    '0 3 * * *',
    () => {
      runReflection().catch((err) => console.error('[job:reflection]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  cron.schedule(
    '0 8 * * *',
    () => {
      runFinanceReview(bot).catch((err) => console.error('[job:finance-review]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  console.log(`[scheduler] reflexão 03:00 e revisão financeira 08:00 ${cfg.TIMEZONE}`);
}
