import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { listOpenTasksWithAge, type TaskWithAge } from '../db/tasks.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

const STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** PURA: seleciona tarefas atrasadas (uma vez por prazo) e paradas (re-emite por semana cheia). */
export function selectTaskEvents(
  tasks: TaskWithAge[],
  today: string,
): Array<{ kind: 'task_overdue' | 'task_stale'; task: TaskWithAge; dedupeKey: string }> {
  const out: Array<{ kind: 'task_overdue' | 'task_stale'; task: TaskWithAge; dedupeKey: string }> = [];
  for (const t of tasks) {
    if (t.dueDate) {
      if (t.dueDate < today) out.push({ kind: 'task_overdue', task: t, dedupeKey: `task:overdue:${t.id}:${t.dueDate}` });
      continue;
    }
    const daysOpen = Math.floor((new Date(`${today}T12:00:00Z`).getTime() - new Date(t.createdAt).getTime()) / MS_PER_DAY);
    if (daysOpen >= STALE_DAYS) {
      out.push({ kind: 'task_stale', task: t, dedupeKey: `task:stale:${t.id}:w${Math.floor(daysOpen / STALE_DAYS)}` });
    }
  }
  return out;
}

export type TaskCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listOpenTasksWithAge: typeof listOpenTasksWithAge;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: TaskCollectorDeps = {
  getUserBySubject,
  listOpenTasksWithAge,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

function ddmm(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export async function collectTaskEvents(deps: TaskCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  let inserted = 0;
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      const tasks = await deps.listOpenTasksWithAge(user.id);
      for (const sel of selectTaskEvents(tasks, today)) {
        const summary =
          sel.kind === 'task_overdue'
            ? `Tarefa atrasada de ${user.name}: "${sel.task.title}" (prazo ${ddmm(sel.task.dueDate!)})`
            : `Tarefa parada há mais de ${STALE_DAYS} dias: "${sel.task.title}" (${user.name})`;
        const r = await deps.insertEvent({ source: 'tasks', kind: sel.kind, dedupeKey: sel.dedupeKey, summary });
        if (r) inserted++;
      }
    } catch (err) {
      console.error(`[collect-tasks] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}
