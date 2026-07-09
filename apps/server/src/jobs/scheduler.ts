import cron from 'node-cron';
import { getConfig } from '../lib/config.js';
import { runReflection } from '../memory/reflection.js';

export function startScheduler(): void {
  const cfg = getConfig();
  cron.schedule(
    '0 3 * * *',
    () => {
      runReflection().catch((err) => console.error('[job:reflection]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  console.log(`[scheduler] reflexão diária às 03:00 ${cfg.TIMEZONE}`);
}
