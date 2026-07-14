import { generateAgentText } from '../agent/models.js';
import { getGroupChatId, getSubjectChatId, getUserBySubject } from '../db/chats.js';
import { listQueuedForTarget, markBriefed, type QueueEvent } from '../db/events.js';
import { listCommitments, type Commitment } from '../db/finance.js';
import { listTasks, type Task } from '../db/tasks.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';
import { computeMonthSummary, type MonthSummary } from '../services/month-summary.js';
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
  queued: string[];
  commitmentsToday: Commitment[];
  finance: MonthSummary | null;
};

function ddmm(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function eventLine(e: CalEvent): string {
  return e.allDay ? `- ${e.title} (dia inteiro)` : `- ${e.title} às ${e.start.slice(11, 16)}`;
}

/** PURA: contexto → prompt com os dados do dia (o modelo escreve a análise). */
export function buildBriefingPrompt(ctx: BriefingContext): string {
  const parts: string[] = [`Data: ${ddmm(ctx.date)}. Pessoa: ${ctx.name}.`];
  if (ctx.agenda.length > 0) parts.push(`Agenda de hoje:\n${ctx.agenda.map(eventLine).join('\n')}`);
  if (ctx.tasks.length > 0)
    parts.push(`Tarefas com prazo até hoje:\n${ctx.tasks.map((t) => `- ${t.title}${t.dueDate ? ` (${ddmm(t.dueDate)})` : ''}`).join('\n')}`);
  if (ctx.commitmentsToday.length > 0)
    parts.push(
      `Compromissos financeiros de hoje:\n${ctx.commitmentsToday.map((c) => `- ${c.description}${c.amount ? ` — ${formatBrl(Number(c.amount))}` : ''}`).join('\n')}`,
    );
  if (ctx.queued.length > 0) parts.push(`Acontecimentos guardados desde ontem:\n${ctx.queued.map((q) => `- ${q}`).join('\n')}`);
  if (ctx.finance) {
    const f = ctx.finance;
    const cats = f.by_category
      .slice(0, 5)
      .map((c) => `- ${c.category}: ${formatBrl(c.spent)}${c.target != null ? ` de ${formatBrl(c.target)}` : ''}`)
      .join('\n');
    parts.push(
      `Situação do mês (${f.month}): receitas ${formatBrl(f.income)}, despesas ${formatBrl(f.expense)}, investido ${formatBrl(f.invested)}, saldo ${formatBrl(f.balance)}, ${f.pending_review} gastos a classificar.${cats ? `\nPor categoria:\n${cats}` : ''}`,
    );
  }
  return parts.join('\n\n');
}

/** PURA: nada a dizer → não manda briefing (silêncio > ruído). */
export function isEmptyBriefing(ctx: BriefingContext): boolean {
  return (
    ctx.agenda.length === 0 &&
    ctx.tasks.length === 0 &&
    ctx.queued.length === 0 &&
    ctx.commitmentsToday.length === 0 &&
    ctx.finance === null
  );
}

const SYSTEM = `Você escreve o briefing matinal de um assistente pessoal.
Análise CURTA e OPINADA em PT-BR — não uma lista burocrática: conecte os pontos, destaque o que importa e o que pode dar errado hoje, sugira no máximo uma ação.
Abra com "Bom dia". Datas como dd/mm, valores como R$ 123,45. Sem ids. Máximo ~10 linhas.`;

export type BriefingDeps = {
  getUserBySubject: typeof getUserBySubject;
  getSubjectChatId: typeof getSubjectChatId;
  getGroupChatId: typeof getGroupChatId;
  listAgenda: (calendarId: string, fromDate: string, toDate: string) => Promise<CalEvent[]>;
  listTasks: typeof listTasks;
  listCommitments: typeof listCommitments;
  listQueuedForTarget: typeof listQueuedForTarget;
  markBriefed: typeof markBriefed;
  monthSummary: (month: string) => Promise<MonthSummary>;
  generate: (system: string, prompt: string) => Promise<string>;
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
    listCommitments,
    listQueuedForTarget,
    markBriefed,
    monthSummary: computeMonthSummary,
    generate: (system, prompt) =>
      generateAgentText({ purpose: 'briefing', system, messages: [{ role: 'user', content: prompt }] }),
    todayIso: () => todayInTz(cfg.TIMEZONE),
  };
}

async function contextFor(subject: 'luis' | 'esposa', deps: BriefingDeps): Promise<{ ctx: BriefingContext; queuedIds: string[] } | null> {
  const user = await deps.getUserBySubject(subject);
  if (!user) return null;
  const today = deps.todayIso();
  const dayOfMonth = Number(today.slice(8, 10));

  const agenda = user.calendarId ? await deps.listAgenda(user.calendarId, today, today).catch(() => []) : [];
  const tasks = (await deps.listTasks(user.id, 'open')).filter((t) => t.dueDate !== null && t.dueDate <= today);
  const queuedEvents: QueueEvent[] = await deps.listQueuedForTarget(subject);
  const commitmentsToday =
    subject === 'luis' ? (await deps.listCommitments()).filter((c) => c.day_of_month === dayOfMonth) : [];
  const finance = subject === 'luis' ? await deps.monthSummary(today.slice(0, 7)) : null;

  return {
    ctx: { name: user.name, date: today, agenda, tasks, queued: queuedEvents.map((q) => q.summary), commitmentsToday, finance },
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
      if (!r || isEmptyBriefing(r.ctx)) continue;
      const chatId = await deps.getSubjectChatId(subject);
      if (chatId === null) continue;
      const text = await deps.generate(SYSTEM, buildBriefingPrompt(r.ctx));
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
    const finance = await deps.monthSummary(today.slice(0, 7));

    const ctx: BriefingContext = {
      name: 'Casal',
      date: today,
      agenda,
      tasks: [],
      queued: queuedEvents.map((q) => q.summary),
      commitmentsToday: [],
      finance,
    };
    const prompt = `${buildBriefingPrompt(ctx)}\n\n(É a visão de SÁBADO do casal: foque no fim de semana e em como o mês está indo.)`;
    const text = await deps.generate(SYSTEM, prompt);
    await send(chatId, text);
    await deps.markBriefed(queuedEvents.map((q) => q.id));
  } catch (err) {
    console.error('[briefing] visão do casal falhou:', err);
  }
}
