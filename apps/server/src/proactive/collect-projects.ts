import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { listActiveProjects } from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { weekStart } from '../services/habit-stats.js';

const STALE_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ProjectCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listActiveProjects: typeof listActiveProjects;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: ProjectCollectorDeps = {
  getUserBySubject,
  listActiveProjects,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

/** Projeto ativo sem movimento (nota/tarefa/status) há N dias → evento; dedupe 1x/semana. */
export async function collectProjectEvents(deps: ProjectCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  const week = weekStart(today);
  const todayMs = new Date(`${today}T12:00:00Z`).getTime();
  let inserted = 0;
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      for (const p of await deps.listActiveProjects(user.id)) {
        const days = Math.floor((todayMs - new Date(p.updatedAt).getTime()) / MS_PER_DAY);
        if (days < STALE_DAYS) continue;
        const r = await deps.insertEvent({
          source: 'projects',
          kind: 'project_stale',
          dedupeKey: `proj:stale:${p.id}:${week}`,
          summary: `Projeto parado: "${p.name}" (${user.name}) sem novidades há ${days} dias`,
        });
        if (r) inserted++;
      }
    } catch (err) {
      console.error(`[collect-projects] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}
