import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { CalEvent } from '../tools/calendar.js';
import {
  collectCalendarEvents,
  diffSnapshots,
  earlyEventsOn,
  findConflicts,
  snapshotOf,
  type CalendarCollectorDeps,
} from './collect-calendar.js';

const ev = (id: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id,
  title: `Evento ${id}`,
  start: '2026-07-15T10:00:00-03:00',
  end: '2026-07-15T11:00:00-03:00',
  allDay: false,
  ...over,
});

describe('diffSnapshots', () => {
  it('detecta novos e alterados', () => {
    const prev = snapshotOf([ev('a'), ev('b')]);
    const curr = snapshotOf([ev('a'), ev('b', { start: '2026-07-15T14:00:00-03:00' }), ev('c')]);
    const d = diffSnapshots(prev, curr);
    expect(d.added).toEqual(['c']);
    expect(d.changed).toEqual(['b']);
  });
});

describe('findConflicts', () => {
  it('pares sobrepostos com hora; ignora all-day e não sobrepostos', () => {
    const a = ev('a', { start: '2026-07-15T10:00:00-03:00', end: '2026-07-15T11:00:00-03:00' });
    const b = ev('b', { start: '2026-07-15T10:30:00-03:00', end: '2026-07-15T12:00:00-03:00' });
    const c = ev('c', { start: '2026-07-15T13:00:00-03:00', end: '2026-07-15T14:00:00-03:00' });
    const d = ev('d', { allDay: true, start: '2026-07-15', end: '2026-07-16' });
    const conflicts = findConflicts([a, b, c, d]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});

describe('earlyEventsOn', () => {
  it('só eventos com hora do dia pedido antes das 09:00', () => {
    const cedo = ev('a', { start: '2026-07-16T07:30:00-03:00' });
    const tarde = ev('b', { start: '2026-07-16T10:00:00-03:00' });
    const outroDia = ev('c', { start: '2026-07-17T07:00:00-03:00' });
    const allDay = ev('d', { allDay: true, start: '2026-07-16', end: '2026-07-17' });
    expect(earlyEventsOn([cedo, tarde, outroDia, allDay], '2026-07-16').map((e) => e.id)).toEqual(['a']);
  });
});

describe('collectCalendarEvents', () => {
  const luis = { id: 'u1', name: 'Luis', calendarId: 'cal-luis', telegramChatId: 1 } as never;

  function deps(over: Partial<CalendarCollectorDeps> = {}): CalendarCollectorDeps {
    const state = new Map<string, unknown>();
    return {
      getUserBySubject: async (s) => (s === 'luis' ? luis : null),
      listEvents: async () => [],
      getState: async (k) => (state.get(k) as never) ?? null,
      setState: async (k, v) => void state.set(k, v),
      insertEvent: async () => ({ id: 'e' }) as never,
      todayIso: () => '2026-07-15',
      timezone: 'America/Sao_Paulo',
      ...over,
    };
  }

  it('primeira execução só salva snapshot, sem eventos', async () => {
    let saved: unknown = null;
    const d = deps({
      listEvents: async () => [ev('a')],
      setState: async (_k, v) => void (saved = v),
    });
    expect(await collectCalendarEvents(d)).toBe(0);
    expect(saved).toEqual(snapshotOf([ev('a')]));
  });

  it('segunda execução emite evento novo com dedupe correto', async () => {
    const state = new Map<string, unknown>([['calendar_snapshot_luis', snapshotOf([ev('a')])]]);
    const inserted: Array<{ dedupeKey: string; kind: string; summary: string }> = [];
    const d = deps({
      listEvents: async () => [ev('a'), ev('c', { title: 'Dentista', start: '2026-07-15T14:00:00-03:00', end: '2026-07-15T15:00:00-03:00' })],
      getState: async (k) => (state.get(k) as never) ?? null,
      setState: async (k, v) => void state.set(k, v),
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e' } as never;
      },
    });
    const n = await collectCalendarEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].kind).toBe('event_new');
    expect(inserted[0].dedupeKey).toBe('cal:new:luis:c');
    expect(inserted[0].summary).toContain('Dentista');
    expect(inserted[0].summary).toContain('Luis');
  });
});
