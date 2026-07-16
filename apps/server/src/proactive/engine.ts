import {
  countNotifiedSince,
  listPendingEvents,
  markNotified,
  resolveEvent,
  type EventTarget,
  type QueueEvent,
} from '../db/events.js';
import { getGroupChatId, getSubjectChatId } from '../db/chats.js';
import { isBankConfigured } from '../lib/banco-mcp.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';
import { calendarApiFromGoogle, zonedDayStartIso } from '../tools/calendar.js';
import { collectFinanceEvents } from './collect-finance.js';
import { collectCalendarEvents, defaultCalendarCollectorDeps } from './collect-calendar.js';
import { collectTaskEvents } from './collect-tasks.js';
import { collectProjectEvents } from './collect-projects.js';
import { judgeEvents, type JudgedDecision } from './judge.js';
import { getProactivityConfig, isQuietHours, localTimeHHMM, type ProactivityConfig } from './rules.js';

export type CollectorSource = 'finance' | 'calendar' | 'tasks' | 'projects';

export type EngineDeps = {
  collectors: Partial<Record<CollectorSource, () => Promise<number>>>;
  listPendingEvents: typeof listPendingEvents;
  judgeEvents: (events: QueueEvent[], nowLocal: string) => Promise<JudgedDecision[]>;
  resolveEvent: typeof resolveEvent;
  markNotified: typeof markNotified;
  countNotifiedSince: typeof countNotifiedSince;
  getSubjectChatId: typeof getSubjectChatId;
  getGroupChatId: typeof getGroupChatId;
  config: () => Promise<ProactivityConfig>;
  nowLocalHHMM: () => string;
  dayStartIso: () => string;
};

/** Deps de produção: coletores reais, respeitando o que está configurado. */
export function defaultEngineDeps(): EngineDeps {
  const cfg = getConfig();
  const collectors: EngineDeps['collectors'] = {
    tasks: () => collectTaskEvents(),
    projects: () => collectProjectEvents(),
  };
  if (isBankConfigured()) collectors.finance = () => collectFinanceEvents();
  if (hasGoogleCreds(cfg)) {
    const api = calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE);
    collectors.calendar = () => collectCalendarEvents(defaultCalendarCollectorDeps(api.listEvents.bind(api)));
  }
  return {
    collectors,
    listPendingEvents,
    judgeEvents,
    resolveEvent,
    markNotified,
    countNotifiedSince,
    getSubjectChatId,
    getGroupChatId,
    config: getProactivityConfig,
    nowLocalHHMM: () => localTimeHHMM(new Date(), cfg.TIMEZONE),
    dayStartIso: () => zonedDayStartIso(todayInTz(cfg.TIMEZONE), cfg.TIMEZONE),
  };
}

async function chatIdFor(target: EventTarget, deps: EngineDeps): Promise<number | null> {
  if (target === 'grupo') return deps.getGroupChatId();
  return deps.getSubjectChatId(target);
}

/** Um ciclo do motor: coleta (sources pedidos) → julga TODOS os pendentes → entrega
 *  os notify respeitando silêncio e teto diário (rebaixados viram queued → briefing). */
export async function runProactiveCycle(
  sources: CollectorSource[],
  send: (chatId: number, text: string) => Promise<void>,
  deps: EngineDeps = defaultEngineDeps(),
): Promise<{ collected: number; judged: number; notified: number }> {
  let collected = 0;
  for (const s of sources) {
    const run = deps.collectors[s];
    if (!run) continue; // source não configurado (sem Google/banco) — no-op
    try {
      collected += await run();
    } catch (err) {
      console.error(`[engine] coletor ${s} falhou:`, err);
    }
  }

  const pending = await deps.listPendingEvents();
  if (pending.length === 0) return { collected, judged: 0, notified: 0 };

  const decisions = await deps.judgeEvents(pending, deps.nowLocalHHMM());
  const cfg = await deps.config();
  const byId = new Map(pending.map((e) => [e.id, e]));
  let notified = 0;

  for (const d of decisions) {
    const event = byId.get(d.id);
    if (!event) continue;

    if (d.decision === 'ignore') {
      await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'ignored' });
      continue;
    }
    if (d.decision === 'briefing') {
      await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'queued' });
      continue;
    }

    // notify — regras de respeito
    if (isQuietHours(deps.nowLocalHHMM(), cfg)) {
      await deps.resolveEvent(d.id, {
        decision: d.decision,
        reason: `${d.reason} [horário de silêncio]`,
        target: d.target,
        status: 'queued',
      });
      continue;
    }
    const sentToday = await deps.countNotifiedSince(deps.dayStartIso(), d.target);
    if (sentToday >= cfg.maxNotificationsPerDay) {
      await deps.resolveEvent(d.id, {
        decision: d.decision,
        reason: `${d.reason} [teto diário atingido]`,
        target: d.target,
        status: 'queued',
      });
      continue;
    }
    const chatId = await chatIdFor(d.target, deps);
    // grava a decisão antes de enviar; se o envio falhar, fica queued (briefing pega)
    await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'queued' });
    if (chatId === null) continue;
    try {
      await send(chatId, `🔔 ${event.summary}`);
      await deps.markNotified(d.id);
      notified++;
    } catch (err) {
      console.error('[engine] envio falhou (evento fica para o briefing):', err);
    }
  }

  return { collected, judged: decisions.length, notified };
}
