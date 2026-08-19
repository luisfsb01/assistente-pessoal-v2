import {
  fromJsonSchema,
  type CallToolResult,
  type McpServer,
} from '@modelcontextprotocol/server';
import { getUserBySubject } from '../db/chats.js';
import { getCheckin, listActiveHabits, pendingHabitsFor, upsertCheckin, type Habit } from '../db/habits.js';
import {
  getProjectTaskForUser,
  listOverdueProjectTasks,
  moveProjectTask,
  type ProjectTask,
} from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { deleteTravelList, listTravelLists } from '../db/lists.js';

type Subject = 'luis' | 'esposa';

export type RoutineMcpDeps = {
  getUserBySubject: typeof getUserBySubject;
  listActiveHabits: typeof listActiveHabits;
  pendingHabitsFor: typeof pendingHabitsFor;
  getCheckin: typeof getCheckin;
  upsertCheckin: typeof upsertCheckin;
  listOverdueProjectTasks: typeof listOverdueProjectTasks;
  getProjectTaskForUser: typeof getProjectTaskForUser;
  moveProjectTask: typeof moveProjectTask;
  listTravelLists: typeof listTravelLists;
  deleteTravelList: typeof deleteTravelList;
  today(): string;
};

const defaultDeps: RoutineMcpDeps = {
  getUserBySubject,
  listActiveHabits,
  pendingHabitsFor,
  getCheckin,
  upsertCheckin,
  listOverdueProjectTasks,
  getProjectTaskForUser,
  moveProjectTask,
  listTravelLists,
  deleteTravelList,
  today: () => todayInTz(getConfig().TIMEZONE),
};

function result(value: Record<string, unknown>, message?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message ?? JSON.stringify(value) }],
    structuredContent: value,
  };
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveHabit(
  subject: Subject,
  habitName: string,
  deps: RoutineMcpDeps,
): Promise<{ userId: string; habit: Habit } | null> {
  const user = await deps.getUserBySubject(subject);
  if (!user) return null;
  const needle = normalized(habitName);
  const habits = await deps.listActiveHabits(user.id);
  const exact = habits.find((habit) => normalized(habit.name) === needle);
  if (exact) return { userId: user.id, habit: exact };
  const partial = habits.filter((habit) => normalized(habit.name).includes(needle));
  return partial.length === 1 ? { userId: user.id, habit: partial[0] } : null;
}

export async function recordHabitCheckin(
  input: { subject: Subject; habit_name: string; done: boolean; date?: string },
  deps: RoutineMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  const resolved = await resolveHabit(input.subject, input.habit_name, deps);
  if (!resolved) return result({ ok: false, verified: false, error_code: 'habit_not_found_or_ambiguous' });
  const date = input.date ?? deps.today();
  await deps.upsertCheckin(resolved.habit.id, date, input.done);
  const saved = await deps.getCheckin(resolved.habit.id, date);
  const verified = saved?.done === input.done;
  return result(
    {
      ok: verified,
      verified,
      subject: input.subject,
      habit_id: resolved.habit.id,
      habit_name: resolved.habit.name,
      date,
      done: input.done,
      ...(!verified ? { error_code: 'verification_failed' } : {}),
    },
    verified ? `${input.done ? '✅' : '❌'} ${resolved.habit.name} confirmado em ${date}.` : 'O check-in não foi confirmado no banco.',
  );
}

export async function updateProjectTaskFromHermes(
  input: { subject: Subject; task_id: string; status: 'todo' | 'doing' | 'done' },
  deps: RoutineMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  const user = await deps.getUserBySubject(input.subject);
  if (!user) return result({ ok: false, verified: false, error_code: 'user_not_found' });
  const before = await deps.getProjectTaskForUser(input.task_id, user.id);
  if (!before) return result({ ok: false, verified: false, error_code: 'task_not_found' });
  await deps.moveProjectTask(before.id, input.status);
  const saved = await deps.getProjectTaskForUser(before.id, user.id);
  const verified = saved?.status === input.status;
  return result(
    {
      ok: verified,
      verified,
      subject: input.subject,
      task_id: before.id,
      task_title: before.title,
      status: saved?.status ?? null,
      ...(!verified ? { error_code: 'verification_failed' } : {}),
    },
    verified ? `Tarefa "${before.title}" confirmada como ${input.status}.` : 'A alteração da tarefa não foi confirmada no banco.',
  );
}

export async function deleteTravelListFromHermes(
  listId: string,
  deps: RoutineMcpDeps = defaultDeps,
): Promise<CallToolResult> {
  const before = (await deps.listTravelLists()).find((list) => list.id === listId);
  if (!before) return result({ ok: false, verified: false, error_code: 'travel_list_not_found' });
  await deps.deleteTravelList(listId);
  const stillExists = (await deps.listTravelLists()).some((list) => list.id === listId);
  return result(
    {
      ok: !stillExists,
      verified: !stillExists,
      list_id: listId,
      list_name: before.name,
      ...(!stillExists ? {} : { error_code: 'verification_failed' }),
    },
    !stillExists ? `Lista da viagem "${before.name}" apagada e conferida.` : 'A exclusão não foi confirmada.',
  );
}

const subjectProperty = { type: 'string' as const, enum: ['luis', 'esposa'], description: 'Dono dos dados.' };
const dateProperty = { type: 'string' as const, pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD; padrão hoje.' };

export function registerRoutineMcpTools(server: McpServer, deps: RoutineMcpDeps = defaultDeps): void {
  server.registerTool(
    'habit_list_pending',
    {
      title: 'Listar hábitos pendentes',
      description: 'Lista os hábitos ainda sem resposta no check-in do dia.',
      inputSchema: fromJsonSchema<{ subject: Subject; date?: string }>({
        type: 'object',
        properties: { subject: subjectProperty, date: dateProperty },
        required: ['subject'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ subject, date }) => {
      const user = await deps.getUserBySubject(subject);
      if (!user) return result({ ok: false, error_code: 'user_not_found' });
      const pending = await deps.pendingHabitsFor(user.id, date ?? deps.today());
      return result({ ok: true, habits: pending });
    },
  );

  server.registerTool(
    'habit_record_checkin',
    {
      title: 'Registrar check-in de hábito',
      description: 'Registra e relê o check-in de um hábito. Só confirme ao usuário quando verified=true.',
      inputSchema: fromJsonSchema<{ subject: Subject; habit_name: string; done: boolean; date?: string }>({
        type: 'object',
        properties: {
          subject: subjectProperty,
          habit_name: { type: 'string', minLength: 1, maxLength: 160 },
          done: { type: 'boolean' },
          date: dateProperty,
        },
        required: ['subject', 'habit_name', 'done'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => recordHabitCheckin(input, deps),
  );

  server.registerTool(
    'project_list_overdue_tasks',
    {
      title: 'Listar tarefas de projeto vencidas',
      description: 'Lista tarefas vencidas com IDs para responder ao check-in noturno.',
      inputSchema: fromJsonSchema<{ subject: Subject; date?: string }>({
        type: 'object',
        properties: { subject: subjectProperty, date: dateProperty },
        required: ['subject'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ subject, date }) => {
      const user = await deps.getUserBySubject(subject);
      if (!user) return result({ ok: false, error_code: 'user_not_found' });
      const tasks = await deps.listOverdueProjectTasks(user.id, date ?? deps.today());
      return result({ ok: true, tasks });
    },
  );

  server.registerTool(
    'project_update_task',
    {
      title: 'Atualizar tarefa de projeto',
      description: 'Atualiza e relê uma tarefa do usuário. Só confirme quando verified=true.',
      inputSchema: fromJsonSchema<{ subject: Subject; task_id: string; status: 'todo' | 'doing' | 'done' }>({
        type: 'object',
        properties: {
          subject: subjectProperty,
          task_id: { type: 'string', minLength: 1, maxLength: 100 },
          status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        },
        required: ['subject', 'task_id', 'status'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => updateProjectTaskFromHermes(input, deps),
  );

  server.registerTool(
    'travel_delete_list',
    {
      title: 'Apagar lista de viagem',
      description: 'Apaga uma lista de viagem após pedido explícito e confere se ela realmente saiu.',
      inputSchema: fromJsonSchema<{ list_id: string }>({
        type: 'object',
        properties: { list_id: { type: 'string', minLength: 1, maxLength: 100 } },
        required: ['list_id'],
        additionalProperties: false,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ list_id }) => deleteTravelListFromHermes(list_id, deps),
  );
}
