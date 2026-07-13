import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import {
  buildCalendarTools,
  zonedDayStartIso,
  type CalEvent,
  type CalendarApi,
  type CalendarToolDeps,
} from './calendar.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const fakeEvents: CalEvent[] = [
    {
      id: 'e1',
      title: 'Reunião',
      start: '2026-07-20T10:00:00-03:00',
      end: '2026-07-20T11:00:00-03:00',
      allDay: false,
    },
  ];
  const calendar: CalendarApi = {
    listEvents: async (calendarId, timeMinIso, timeMaxIso) => {
      calls.push(`list:${calendarId}:${timeMinIso}:${timeMaxIso}`);
      return fakeEvents;
    },
    insertEvent: async (calendarId, body) => {
      calls.push(`insert:${calendarId}:${JSON.stringify(body)}`);
      return {
        id: 'new1',
        title: body.title,
        start: body.startIso ?? body.startDate ?? '',
        end: body.endIso ?? body.endDate ?? '',
        allDay: Boolean(body.startDate),
      };
    },
    patchEvent: async (calendarId, eventId, body) => {
      calls.push(`patch:${calendarId}:${eventId}:${JSON.stringify(body)}`);
    },
    deleteEvent: async (calendarId, eventId) => {
      calls.push(`delete:${calendarId}:${eventId}`);
    },
  };
  const deps: CalendarToolDeps = {
    getUserBySubject: async (s) => ({
      id: `uid-${s}`,
      name: s === 'luis' ? 'Luis' : 'Esposa',
      calendarId: `cal-${s}`,
    }),
    calendar,
    timezone: 'America/Sao_Paulo',
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildCalendarTools', () => {
  it('cria evento com hora no privado do Luis', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_create_event', {
      title: 'Dentista',
      start: '2026-07-20T14:00:00-03:00',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('insert:cal-luis:');
    expect(calls[0]).toContain('"startIso":"2026-07-20T14:00:00-03:00"');
    expect(out).toContain('Dentista');
  });

  it('cria evento all_day', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_create_event', {
      title: 'Viagem',
      all_day: true,
      date: '2026-07-20',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('insert:cal-luis:');
    expect(calls[0]).toContain('"startDate":"2026-07-20"');
    expect(out).toContain('Viagem');
  });

  it('all_day de vários dias: end_date é inclusivo (Google usa fim exclusivo => +1 dia)', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_create_event', {
      title: 'Viagem',
      all_day: true,
      date: '2026-07-20',
      end_date: '2026-07-25',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"startDate":"2026-07-20"');
    expect(calls[0]).toContain('"endDate":"2026-07-26"');
    expect(out).toContain('Viagem');
  });

  it('grupo sem owner: pede para especificar', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildCalendarTools(grupo, deps), 'calendar_list_events', {
      from_date: '2026-07-20',
      to_date: '2026-07-20',
    });
    expect(calls).toEqual([]);
    expect(out.toLowerCase()).toContain('especifique owner');
  });

  it('calendarId não configurado: mensagem amigável, nenhuma chamada', async () => {
    const { deps, calls } = makeDeps();
    deps.getUserBySubject = async () => ({ id: 'uid-luis', name: 'Luis', calendarId: null });
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_list_events', {
      from_date: '2026-07-20',
      to_date: '2026-07-20',
    });
    expect(calls).toEqual([]);
    expect(out).toContain('não foi configurada');
  });

  it('calendar_list_events retorna JSON com os eventos do fake', async () => {
    const { deps } = makeDeps();
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_list_events', {
      from_date: '2026-07-20',
      to_date: '2026-07-20',
    });
    expect(JSON.parse(out)).toEqual([
      {
        id: 'e1',
        title: 'Reunião',
        start: '2026-07-20T10:00:00-03:00',
        end: '2026-07-20T11:00:00-03:00',
        allDay: false,
      },
    ]);
  });

  it('erro na API vira mensagem amigável', async () => {
    const { deps } = makeDeps();
    deps.calendar.listEvents = async () => {
      throw new Error('boom');
    };
    const out = await exec(buildCalendarTools(luis, deps), 'calendar_list_events', {
      from_date: '2026-07-20',
      to_date: '2026-07-20',
    });
    expect(out.toLowerCase()).toContain('não consegui');
  });

  it('zonedDayStartIso calcula o offset real de America/Sao_Paulo', () => {
    const iso = zonedDayStartIso('2026-07-20', 'America/Sao_Paulo');
    expect(iso).toMatch(/^2026-07-20T00:00:00-03:00$/);
  });

  it('start ISO naive (sem offset) é normalizado para o fuso de São Paulo e o end padrão fica correto', async () => {
    const { deps, calls } = makeDeps();
    await exec(buildCalendarTools(luis, deps), 'calendar_create_event', {
      title: 'Dentista',
      start: '2026-07-16T15:00:00',
    });
    expect(calls).toHaveLength(1);
    const insertCall = calls[0];
    const body = JSON.parse(insertCall.slice(insertCall.indexOf('{')));
    const { startIso, endIso } = body as { startIso: string; endIso: string };
    expect(startIso).toContain('-03:00');
    expect(new Date(startIso).toISOString()).toBe('2026-07-16T18:00:00.000Z');
    expect(new Date(endIso).getTime() - new Date(startIso).getTime()).toBe(3600000);
  });
});
