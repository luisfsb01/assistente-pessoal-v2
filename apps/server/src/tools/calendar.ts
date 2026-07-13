import { tool, type ToolSet } from 'ai';
import type { calendar_v3 } from 'googleapis';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import type { UserRecord } from '../db/chats.js';

export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean };

export type CalEventBody = {
  title: string;
  startIso?: string; // datetime ISO (eventos com hora)
  endIso?: string;
  startDate?: string; // YYYY-MM-DD (all_day)
  endDate?: string;
};

export type CalendarApi = {
  listEvents(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<CalEvent[]>;
  insertEvent(calendarId: string, body: CalEventBody): Promise<CalEvent>;
  patchEvent(calendarId: string, eventId: string, body: Partial<CalEventBody>): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
};

export type CalendarToolDeps = {
  getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>;
  calendar: CalendarApi;
  timezone: string;
};

// ---- timezone helpers -----------------------------------------------------

/** Offset real (ex.: "-03:00") do timezone `tz` no dia `date` (YYYY-MM-DD). */
function offsetForZone(date: string, tz: string): string {
  // Usamos meio-dia UTC daquele dia para evitar bordas de troca de horário em torno da meia-noite.
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(probe);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // Em UTC/offset zero alguns runtimes formatam apenas "GMT" (sem "+00:00").
  if (raw === 'GMT') return '+00:00';
  const match = /GMT([+-]\d{2}:\d{2})/.exec(raw);
  return match ? match[1] : '+00:00';
}

export function zonedDayStartIso(date: string, tz: string): string {
  return `${date}T00:00:00${offsetForZone(date, tz)}`;
}

export function zonedDayEndIso(date: string, tz: string): string {
  return `${date}T23:59:59${offsetForZone(date, tz)}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ---- googleapis translation ------------------------------------------------

export function calendarApiFromGoogle(client: calendar_v3.Calendar, timezone: string): CalendarApi {
  function mapEvent(e: calendar_v3.Schema$Event): CalEvent {
    const allDay = Boolean(e.start?.date);
    return {
      id: e.id ?? '',
      title: e.summary ?? '',
      start: (allDay ? e.start?.date : e.start?.dateTime) ?? '',
      end: (allDay ? e.end?.date : e.end?.dateTime) ?? '',
      allDay,
    };
  }

  function toGoogleEvent(body: CalEventBody | Partial<CalEventBody>): calendar_v3.Schema$Event {
    const out: calendar_v3.Schema$Event = {};
    if (body.title !== undefined) out.summary = body.title;
    if (body.startDate !== undefined) out.start = { date: body.startDate };
    else if (body.startIso !== undefined) out.start = { dateTime: body.startIso, timeZone: timezone };
    if (body.endDate !== undefined) out.end = { date: body.endDate };
    else if (body.endIso !== undefined) out.end = { dateTime: body.endIso, timeZone: timezone };
    return out;
  }

  return {
    async listEvents(calendarId, timeMinIso, timeMaxIso) {
      const res = await client.events.list({
        calendarId,
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items ?? []).map(mapEvent);
    },
    async insertEvent(calendarId, body) {
      const res = await client.events.insert({ calendarId, requestBody: toGoogleEvent(body) });
      return mapEvent(res.data);
    },
    async patchEvent(calendarId, eventId, body) {
      await client.events.patch({ calendarId, eventId, requestBody: toGoogleEvent(body) });
    },
    async deleteEvent(calendarId, eventId) {
      await client.events.delete({ calendarId, eventId });
    },
  };
}

// ---- tools ------------------------------------------------------------------

const ownerParam = z
  .enum(['luis', 'esposa'])
  .optional()
  .describe('De quem é a agenda; obrigatório no grupo, no privado o padrão é o dono do chat');

const ASK_OWNER = 'Preciso saber de quem é a agenda — especifique owner: luis ou esposa.';
const FAIL = 'Não consegui acessar a agenda agora. Tenta de novo em instantes.';

function resolveSubject(
  identity: ChatIdentity,
  owner?: 'luis' | 'esposa',
): 'luis' | 'esposa' | null {
  return owner ?? identity.subject;
}

export function buildCalendarTools(identity: ChatIdentity, deps: CalendarToolDeps): ToolSet {
  return {
    calendar_list_events: tool({
      description: 'Lista eventos da agenda entre duas datas (from_date/to_date, YYYY-MM-DD, inclusivo).',
      inputSchema: z.object({
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        owner: ownerParam,
      }),
      execute: async ({ from_date, to_date, owner }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          if (!user.calendarId)
            return `A agenda de ${user.name} ainda não foi configurada (users.calendar_id).`;
          const timeMin = zonedDayStartIso(from_date, deps.timezone);
          const timeMax = zonedDayEndIso(to_date, deps.timezone);
          const events = await deps.calendar.listEvents(user.calendarId, timeMin, timeMax);
          return JSON.stringify(events);
        } catch {
          return FAIL;
        }
      },
    }),
    calendar_create_event: tool({
      description:
        'Cria um evento na agenda. Use start (ISO com hora) para eventos com hora (end padrão +1h), ou all_day + date (YYYY-MM-DD) para dia inteiro — end_date opcional é o ÚLTIMO dia, inclusivo.',
      inputSchema: z.object({
        title: z.string(),
        start: z.string().optional(),
        end: z.string().optional(),
        all_day: z.boolean().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Último dia do evento all-day (inclusivo); padrão é o mesmo dia de date'),
        owner: ownerParam,
      }),
      execute: async ({ title, start, end, all_day, date, end_date, owner }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        if (all_day) {
          if (!date) return 'Informe date (YYYY-MM-DD) para criar um evento de dia inteiro.';
        } else if (!start) {
          return 'Informe start (data/hora ISO) ou all_day + date para criar o evento.';
        }
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          if (!user.calendarId)
            return `A agenda de ${user.name} ainda não foi configurada (users.calendar_id).`;
          // Google trata end.date de eventos all-day como EXCLUSIVO; end_date aqui é inclusivo,
          // então somamos 1 dia ao último dia informado (ou ao próprio date).
          const body = all_day
            ? { title, startDate: date!, endDate: addDays(end_date ?? date!, 1) }
            : {
                title,
                startIso: start!,
                endIso: end ?? new Date(new Date(start!).getTime() + 60 * 60 * 1000).toISOString(),
              };
          const created = await deps.calendar.insertEvent(user.calendarId, body);
          return `Evento criado para ${user.name}: "${created.title}".`;
        } catch {
          return FAIL;
        }
      },
    }),
    calendar_update_event: tool({
      description: 'Atualiza título e/ou horário de um evento (use o id retornado por calendar_list_events).',
      inputSchema: z.object({
        event_id: z.string(),
        owner: ownerParam,
        title: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }),
      execute: async ({ event_id, owner, title, start, end }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          if (!user.calendarId)
            return `A agenda de ${user.name} ainda não foi configurada (users.calendar_id).`;
          await deps.calendar.patchEvent(user.calendarId, event_id, {
            title,
            startIso: start,
            endIso: end,
          });
          return 'Evento atualizado.';
        } catch {
          return FAIL;
        }
      },
    }),
    calendar_delete_event: tool({
      description: 'Remove um evento da agenda (use o id retornado por calendar_list_events).',
      inputSchema: z.object({ event_id: z.string(), owner: ownerParam }),
      execute: async ({ event_id, owner }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          if (!user.calendarId)
            return `A agenda de ${user.name} ainda não foi configurada (users.calendar_id).`;
          await deps.calendar.deleteEvent(user.calendarId, event_id);
          return 'Evento removido.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
