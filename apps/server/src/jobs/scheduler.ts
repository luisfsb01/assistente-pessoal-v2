import cron from 'node-cron';
import type { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { hasGoogleCreds } from '../lib/google.js';
import { isBankConfigured } from '../lib/banco-mcp.js';
import { runReflection } from '../memory/reflection.js';
import { runFinanceReview } from './finance-review.js';
import { runDailyBriefing, runCoupleBriefing } from './briefing.js';
import { runProactiveCycle, type CollectorSource } from '../proactive/engine.js';
import { runEmailCleanup } from './email-cleanup.js';
import { runLibrarian } from './librarian.js';
import { runDailyCheckin } from './daily-checkin.js';

export function startScheduler(bot: Bot): void {
  const cfg = getConfig();
  const opts = { timezone: cfg.TIMEZONE };
  const send = (chatId: number, text: string) => bot.api.sendMessage(chatId, text).then(() => undefined);
  const cycle = (sources: CollectorSource[], label: string) => () => {
    runProactiveCycle(sources, send).catch((err) => console.error(`[job:proactive:${label}]`, err));
  };

  cron.schedule('0 3 * * *', () => {
    runReflection().catch((err) => console.error('[job:reflection]', err));
  }, opts);

  cron.schedule('0 8 * * *', () => {
    runFinanceReview(bot).catch((err) => console.error('[job:finance-review]', err));
  }, opts);

  // Proatividade (spec §4): calendário 30min, banco 2h, tarefas 1x/dia antes do briefing
  if (hasGoogleCreds(cfg)) cron.schedule('*/30 * * * *', cycle(['calendar'], 'calendar'), opts);
  if (isBankConfigured()) cron.schedule('0 */2 * * *', cycle(['finance'], 'finance'), opts);
  cron.schedule('30 6 * * *', cycle(['tasks', 'projects'], 'tasks+projects'), opts);

  // Limpeza do Gmail (Fase 5): 30 em 30 min; sem escopo gmail.modify o job só loga o erro
  if (hasGoogleCreds(cfg)) {
    cron.schedule('*/30 * * * *', () => {
      runEmailCleanup().catch((err) => console.error('[job:email-cleanup]', err));
    }, opts);
  }

  // Bibliotecário do segundo cérebro (Fase 6): processa fontes novas de madrugada
  cron.schedule('0 4 * * *', () => {
    runLibrarian().catch((err) => console.error('[job:librarian]', err));
  }, opts);

  // Check-in de hábitos + tarefas vencidas (Fase 7): rotina direta, sem juiz
  cron.schedule('0 21 * * *', () => {
    runDailyCheckin((chatId, text, kb) =>
      bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
    ).catch((err) => console.error('[job:checkin]', err));
  }, opts);

  // Briefing matinal (modelo forte) + visão do casal aos sábados
  cron.schedule('0 7 * * *', () => {
    runDailyBriefing(send).catch((err) => console.error('[job:briefing]', err));
  }, opts);
  cron.schedule('0 8 * * 6', () => {
    runCoupleBriefing(send).catch((err) => console.error('[job:briefing-casal]', err));
  }, opts);

  console.log(
    `[scheduler] reflexão 03:00, bibliotecário 04:00, revisão financeira 08:00, briefing 07:00 (+casal sáb 08:00), check-in 21:00, coletores: calendário ${hasGoogleCreds(cfg) ? '30min' : 'off'}, banco ${isBankConfigured() ? '2h' : 'off'}, tarefas+projetos 06:30, gmail ${hasGoogleCreds(cfg) ? '30min' : 'off'} — ${cfg.TIMEZONE}`,
  );
}
