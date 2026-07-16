import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUserBySubject, type ChatIdentity } from '../db/chats.js';
import {
  archiveHabit,
  createHabit,
  listActiveHabits,
  listCheckinsBetween,
  upsertCheckin,
} from '../db/habits.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { weekProgress, weekStart } from '../services/habit-stats.js';

export type HabitToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  listActiveHabits: typeof listActiveHabits;
  createHabit: typeof createHabit;
  archiveHabit: typeof archiveHabit;
  upsertCheckin: typeof upsertCheckin;
  listCheckinsBetween: typeof listCheckinsBetween;
  todayIso: () => string;
};

const defaultDeps: HabitToolDeps = {
  getUserBySubject,
  listActiveHabits,
  createHabit,
  archiveHabit,
  upsertCheckin,
  listCheckinsBetween,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

const FAIL = 'Não consegui acessar os hábitos agora. Tenta de novo em instantes.';
const SEM_DONO = 'Hábitos são individuais — de quem é? (Luis ou esposa)';

async function userIdFor(identity: ChatIdentity, deps: HabitToolDeps): Promise<string | null> {
  if (!identity.subject) return null;
  return (await deps.getUserBySubject(identity.subject))?.id ?? null;
}

export function buildHabitTools(identity: ChatIdentity, deps: HabitToolDeps = defaultDeps): ToolSet {
  return {
    habit_define: tool({
      description: 'Cria um hábito com meta semanal para acompanhar (ex.: academia 3x por semana).',
      inputSchema: z.object({
        name: z.string().min(2),
        target_per_week: z.number().int().min(1).max(7),
      }),
      execute: async ({ name, target_per_week }) => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const h = await deps.createHabit(userId, name, target_per_week);
          return `Hábito "${h.name}" criado — meta ${h.targetPerWeek}x por semana. Check-in todo dia às 21h.`;
        } catch {
          return FAIL;
        }
      },
    }),
    habit_list: tool({
      description: 'Lista os hábitos da pessoa com o progresso da semana corrente.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const habits = await deps.listActiveHabits(userId);
          if (habits.length === 0) return 'Nenhum hábito cadastrado ainda.';
          const today = deps.todayIso();
          const from = weekStart(today);
          const checkins = await deps.listCheckinsBetween(habits.map((h) => h.id), from, today);
          const progress = weekProgress(habits, checkins, from, today);
          return JSON.stringify(
            habits.map((h, i) => ({ id: h.id, habito: h.name, semana: `${progress[i].done}/${progress[i].target}` })),
          );
        } catch {
          return FAIL;
        }
      },
    }),
    habit_checkin: tool({
      description:
        'Registra o hábito de um dia por conversa ("fui na academia", "hoje não li"). done=false também é registro.',
      inputSchema: z.object({
        habit_name: z.string(),
        done: z.boolean(),
        date: z.string().optional().describe('YYYY-MM-DD; padrão hoje'),
      }),
      execute: async ({ habit_name, done, date }) => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const habits = await deps.listActiveHabits(userId);
          const habit = habits.find((h) => h.name.toLowerCase().includes(habit_name.toLowerCase()));
          if (!habit) return `não achei o hábito "${habit_name}". Os ativos: ${habits.map((h) => h.name).join(', ') || 'nenhum'}.`;
          await deps.upsertCheckin(habit.id, date ?? deps.todayIso(), done);
          return `${done ? '✅' : '❌'} ${habit.name} registrado.`;
        } catch {
          return FAIL;
        }
      },
    }),
    habit_archive: tool({
      description: 'Arquiva (desativa) um hábito — use o id retornado por habit_list.',
      inputSchema: z.object({ habit_id: z.string() }),
      execute: async ({ habit_id }) => {
        try {
          await deps.archiveHabit(habit_id);
          return 'Hábito arquivado.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
