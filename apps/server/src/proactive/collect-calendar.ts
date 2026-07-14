import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { getState, setState } from '../db/state.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { zonedDayEndIso, zonedDayStartIso, type CalEvent } from '../tools/calendar.js';

export type CalSnapshot = Record<string, { title: string; start: string; end: string }>;

export function snapshotOf(events: CalEvent[]): CalSnapshot {
  const out: CalSnapshot = {};
  for (const e of events) out[e.id] = { title: e.title, start: e.start, end: e.end };
  return out;
}

export function diffSnapshots(prev: CalSnapshot, curr: CalSnapshot): { added: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, e] of Object.entries(curr)) {
    const old = prev[id];
    if (!old) added.push(id);
    else if (old.title !== e.title || old.start !== e.start || old.end !== e.end) changed.push(id);
  }
  return { added, changed };
}

/** Pares de eventos com hora que se sobrepõem (all-day fora). */
export function findConflicts(events: CalEvent[]): Array<[CalEvent, CalEvent]> {
  const timed = events.filter((e) => !e.allDay);
  const out: Array<[CalEvent, CalEvent]> = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)) out.push([a, b]);
    }
  }
  return out;
}

/** Eventos com hora do dia `date` começando antes das 09:00 locais. */
export function earlyEventsOn(events: CalEvent[], date: string): CalEvent[] {
  return events.filter((e) => !e.allDay && e.start.slice(0, 10) === date && e.start.slice(11, 13) < '09');
}

function ddmm(start: string): string {
  const [, m, d] = start.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function whenLabel(e: CalEvent): string {
  return e.allDay ? ddmm(e.start) : `${ddmm(e.start)} ${e.start.slice(11, 16)}`;
}

export type CalendarCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listEvents: (calendarId: string, timeMinIso: string, timeMaxIso: string) => Promise<CalEvent[]>;
  getState: typeof getState;
  setState: typeof setState;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
  timezone: string;
};

/** Coleta eventos de agenda dos dois: novos/alterados (diff de snapshot), conflitos
 *  e compromissos de amanhã cedo. Primeira execução por pessoa só grava o snapshot. */
export async function collectCalendarEvents(deps: CalendarCollectorDeps): Promise<number> {
  const today = deps.todayIso();
  const tomorrow = addDays(today, 1);
  let inserted = 0;

  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user?.calendarId) continue;

      const events = await deps.listEvents(
        user.calendarId,
        zonedDayStartIso(today, deps.timezone),
        zonedDayEndIso(addDays(today, 7), deps.timezone),
      );
      const stateKey = `calendar_snapshot_${subject}`;
      const prev = await deps.getState<CalSnapshot>(stateKey);
      const curr = snapshotOf(events);

      if (prev === null) {
        await deps.setState(stateKey, curr); // primeira vez: só baseline
        continue;
      }

      const byId = new Map(events.map((e) => [e.id, e]));
      const { added, changed } = diffSnapshots(prev, curr);

      for (const id of added) {
        const e = byId.get(id)!;
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'event_new',
          dedupeKey: `cal:new:${subject}:${id}`,
          summary: `Evento novo na agenda de ${user.name}: "${e.title}" ${whenLabel(e)}`,
        });
        if (r) inserted++;
      }
      for (const id of changed) {
        const e = byId.get(id)!;
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'event_changed',
          dedupeKey: `cal:changed:${subject}:${id}:${e.start}`,
          summary: `Evento alterado na agenda de ${user.name}: "${e.title}" agora ${whenLabel(e)}`,
        });
        if (r) inserted++;
      }
      for (const [a, b] of findConflicts(events)) {
        const [lo, hi] = [a.id, b.id].sort();
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'calendar_conflict',
          dedupeKey: `cal:conflict:${subject}:${lo}:${hi}`,
          summary: `Conflito na agenda de ${user.name}: "${a.title}" e "${b.title}" se sobrepõem em ${ddmm(a.start)}`,
        });
        if (r) inserted++;
      }
      for (const e of earlyEventsOn(events, tomorrow)) {
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'early_tomorrow',
          dedupeKey: `cal:early:${subject}:${e.id}:${tomorrow}`,
          summary: `Amanhã cedo (${e.start.slice(11, 16)}): "${e.title}" — agenda de ${user.name}`,
        });
        if (r) inserted++;
      }

      await deps.setState(stateKey, curr);
    } catch (err) {
      console.error(`[collect-calendar] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}

/** Deps default de produção (calendar client é injetado pelo engine — ver Task 8). */
export function defaultCalendarCollectorDeps(listEvents: CalendarCollectorDeps['listEvents']): CalendarCollectorDeps {
  const cfg = getConfig();
  return {
    getUserBySubject,
    listEvents,
    getState,
    setState,
    insertEvent,
    todayIso: () => todayInTz(cfg.TIMEZONE),
    timezone: cfg.TIMEZONE,
  };
}
