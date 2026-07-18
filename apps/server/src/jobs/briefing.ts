import { getGroupChatId, getSubjectChatId, getUserBySubject } from '../db/chats.js';
import { listQueuedForTarget, markBriefed } from '../db/events.js';
import { listCommitments, type Commitment } from '../db/finance.js';
import { listActiveHabits, listCheckinsBetween } from '../db/habits.js';
import { listProjectTasksDueOn, type ProjectTask } from '../db/projects.js';
import { listTasks, type Task } from '../db/tasks.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';
import { weekProgress, weekStart, type HabitProgress } from '../services/habit-stats.js';
import {
  calendarApiFromGoogle,
  zonedDayEndIso,
  zonedDayStartIso,
  type CalEvent,
} from '../tools/calendar.js';

export type BriefingContext = {
  name: string;
  date: string;
  agenda: CalEvent[];
  tasks: Task[];
  projectActions: Array<ProjectTask & { projectName: string }>;
  commitmentsToday: Commitment[];
  habits: HabitProgress[] | null;
};

function ddmm(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function eventLine(e: CalEvent): string {
  return e.allDay ? `• ${e.title} (dia inteiro)` : `• ${e.title} às ${e.start.slice(11, 16)}`;
}

/** Saída determinística: somente itens operacionais, sem análises ou recomendações da IA. */
export function formatDailyBriefing(ctx: BriefingContext): string {
  const parts: string[] = [`☀️ BOM DIA, ${ctx.name.toLocaleUpperCase('pt-BR')} — ${ddmm(ctx.date)}`];
  if (ctx.agenda.length > 0) parts.push(`📅 COMPROMISSOS\n${ctx.agenda.map(eventLine).join('\n')}`);
  if (ctx.tasks.length > 0)
    parts.push(`✅ TAREFAS\n${ctx.tasks.map((t) => `• ${t.title}`).join('\n')}`);
  if (ctx.projectActions.length > 0)
    parts.push(`📁 PROJETOS\n${ctx.projectActions.map((t) => `• ${t.projectName}: ${t.title}`).join('\n')}`);
  if (ctx.commitmentsToday.length > 0)
    parts.push(
      `💳 COMPROMISSOS FINANCEIROS\n${ctx.commitmentsToday.map((c) => `• ${c.description}${c.amount ? ` — ${formatBrl(Number(c.amount))}` : ''}`).join('\n')}`,
    );
  if (ctx.habits && ctx.habits.length > 0)
    parts.push(`🔁 HÁBITOS\n${ctx.habits.map((h) => `• ${h.name}: ${h.done}/${h.target} nesta semana`).join('\n')}`);
  return parts.join('\n\n');
}

/** PURA: nada a dizer → não manda briefing (silêncio > ruído). */
export function isEmptyBriefing(ctx: BriefingContext): boolean {
  return (
    ctx.agenda.length === 0 &&
    ctx.tasks.length === 0 &&
    ctx.projectActions.length === 0 &&
    ctx.commitmentsToday.length === 0 &&
    ctx.habits === null
  );
}

export type BriefingDeps = {
  getUserBySubject: typeof getUserBySubject;
  getSubjectChatId: typeof getSubjectChatId;
  getGroupChatId: typeof getGroupChatId;
  listAgenda: (calendarId: string, fromDate: string, toDate: string) => Promise<CalEvent[]>;
  listTasks: typeof listTasks;
  listProjectTasksDueOn: typeof listProjectTasksDueOn;
  listCommitments: typeof listCommitments;
  listQueuedForTarget: typeof listQueuedForTarget;
  listActiveHabits: typeof listActiveHabits;
  listHabitCheckins: typeof listCheckinsBetween;
  markBriefed: typeof markBriefed;
  todayIso: () => string;
};

export function defaultBriefingDeps(): BriefingDeps {
  const cfg = getConfig();
  const listAgenda: BriefingDeps['listAgenda'] = hasGoogleCreds(cfg)
    ? (calendarId, fromDate, toDate) =>
        calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE).listEvents(
          calendarId,
          zonedDayStartIso(fromDate, cfg.TIMEZONE),
          zonedDayEndIso(toDate, cfg.TIMEZONE),
        )
    : async () => [];
  return {
    getUserBySubject,
    getSubjectChatId,
    getGroupChatId,
    listAgenda,
    listTasks,
    listProjectTasksDueOn,
    listCommitments,
    listQueuedForTarget,
    listActiveHabits,
    listHabitCheckins: listCheckinsBetween,
    markBriefed,
    todayIso: () => todayInTz(cfg.TIMEZONE),
  };
}

async function contextFor(subject: 'luis' | 'esposa', deps: BriefingDeps): Promise<{ ctx: BriefingContext; queuedIds: string[] } | null> {
  const user = await deps.getUserBySubject(subject);
  if (!user) return null;
  const today = deps.todayIso();
  const dayOfMonth = Number(today.slice(8, 10));

  const agenda = user.calendarId ? await deps.listAgenda(user.calendarId, today, today).catch(() => []) : [];
  const tasks = (await deps.listTasks(user.id, 'open')).filter((t) => t.dueDate === today);
  const projectActions = await deps.listProjectTasksDueOn(user.id, today).catch(() => []);
  const queuedEvents = await deps.listQueuedForTarget(subject);
  const commitmentsToday =
    subject === 'luis' ? (await deps.listCommitments()).filter((c) => c.day_of_month === dayOfMonth) : [];

  let habitsCtx: BriefingContext['habits'] = null;
  const activeHabits = await deps.listActiveHabits(user.id).catch(() => []);
  if (activeHabits.length > 0) {
    const wFrom = weekStart(today);
    const checkins = await deps.listHabitCheckins(activeHabits.map((h) => h.id), wFrom, today).catch(() => []);
    habitsCtx = weekProgress(activeHabits, checkins, wFrom, today);
  }

  return {
    ctx: {
      name: user.name,
      date: today,
      agenda,
      tasks,
      projectActions,
      commitmentsToday,
      habits: habitsCtx,
    },
    queuedIds: queuedEvents.map((q) => q.id),
  };
}

/** Briefing individual das 07:00 — cada pessoa no seu privado; vazio não é enviado. */
export async function runDailyBriefing(
  send: (chatId: number, text: string) => Promise<void>,
  deps: BriefingDeps = defaultBriefingDeps(),
): Promise<void> {
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const r = await contextFor(subject, deps);
      if (!r) continue;
      if (isEmptyBriefing(r.ctx)) {
        await deps.markBriefed(r.queuedIds);
        continue;
      }
      const chatId = await deps.getSubjectChatId(subject);
      if (chatId === null) continue;
      const text = formatDailyBriefing(r.ctx);
      await send(chatId, text);
      await deps.markBriefed(r.queuedIds);
    } catch (err) {
      console.error(`[briefing] falhou para ${subject}:`, err);
    }
  }
}

/** Visão do casal — sábados no grupo: fim de semana dos dois + mês + eventos do grupo. */
export async function runCoupleBriefing(
  send: (chatId: number, text: string) => Promise<void>,
  deps: BriefingDeps = defaultBriefingDeps(),
): Promise<void> {
  try {
    const chatId = await deps.getGroupChatId();
    if (chatId === null) return;
    const today = deps.todayIso();
    const sunday = addDays(today, 1);

    const agenda: CalEvent[] = [];
    for (const subject of ['luis', 'esposa'] as const) {
      const user = await deps.getUserBySubject(subject);
      if (!user?.calendarId) continue;
      const events = await deps.listAgenda(user.calendarId, today, sunday).catch(() => [] as CalEvent[]);
      agenda.push(...events.map((e) => ({ ...e, title: `${e.title} (${user.name})` })));
    }
    const queuedEvents = await deps.listQueuedForTarget('grupo');
    const ctx: BriefingContext = {
      name: 'Casal',
      date: today,
      agenda,
      tasks: [],
      projectActions: [],
      commitmentsToday: [],
      habits: null,
    };
    if (isEmptyBriefing(ctx)) {
      await deps.markBriefed(queuedEvents.map((q) => q.id));
      return;
    }
    const text = formatDailyBriefing(ctx);
    await send(chatId, text);
    await deps.markBriefed(queuedEvents.map((q) => q.id));
  } catch (err) {
    console.error('[briefing] visão do casal falhou:', err);
  }
}
