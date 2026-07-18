import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject, type UserRecord } from '../db/chats.js';
import { addTask, completeTask, listTasks, updateTask, type Task } from '../db/tasks.js';
import type { TaskRecurrenceFlow } from '../agent/task-recurrence-flow.js';

export type TaskToolDeps = {
  getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>;
  listTasks: typeof listTasks;
  addTask: typeof addTask;
  completeTask: typeof completeTask;
  updateTask: typeof updateTask;
};

const defaultDeps: TaskToolDeps = { getUserBySubject, listTasks, addTask, completeTask, updateTask };

const recurrenceSchema = z.object({
  unit: z
    .enum(['day', 'week', 'month'])
    .describe('Unidade da frequência: day, week ou month'),
  interval: z.number().int().min(1).max(365).default(1).describe('Repetir a cada N unidades'),
  until_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Data final da recorrência em YYYY-MM-DD'),
});

const ownerParam = z
  .enum(['luis', 'esposa'])
  .optional()
  .describe('De quem é a tarefa; obrigatório no grupo, no privado o padrão é o dono do chat');

const ASK_OWNER = 'Preciso saber de quem é a tarefa — especifique owner: luis ou esposa.';
const FAIL = 'Não consegui acessar as tarefas agora. Tenta de novo em instantes.';

function resolveSubject(
  identity: ChatIdentity,
  owner?: 'luis' | 'esposa',
): 'luis' | 'esposa' | null {
  return owner ?? identity.subject;
}

export function buildTaskTools(
  identity: ChatIdentity,
  deps: TaskToolDeps = defaultDeps,
  recurrenceFlow?: TaskRecurrenceFlow,
): ToolSet {
  return {
    tasks_list: tool({
      description: 'Lista tarefas de uma pessoa (abertas por padrão).',
      inputSchema: z.object({ owner: ownerParam, status: z.enum(['open', 'done']).optional() }),
      execute: async ({ owner, status }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          const tasks = await deps.listTasks(user.id, status ?? 'open');
          if (tasks.length === 0)
            return `Nenhuma tarefa ${status === 'done' ? 'concluída' : 'aberta'} de ${user.name}.`;
          return JSON.stringify(
            tasks.map((t: Task) => ({
              id: t.id,
              title: t.title,
              due: t.dueDate,
              recurrence: t.recurrence,
            })),
          );
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_add: tool({
      description:
        'Cria uma tarefa. Recorrência é opcional e só deve ser enviada se a pessoa disser explicitamente que a tarefa é recorrente; nesse caso, frequência e data final são obrigatórias.',
      inputSchema: z.object({
        title: z.string(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        recurrence: recurrenceSchema.optional(),
        owner: ownerParam,
      }),
      execute: async ({ title, due_date, recurrence, owner }) => {
        const subject = resolveSubject(identity, owner);
        if (!subject) return ASK_OWNER;
        if (recurrenceFlow?.explicit && !recurrenceFlow.frequencyProvided)
          return 'Não crie a tarefa ainda. Pergunte apenas qual é a frequência da tarefa recorrente.';
        if (recurrenceFlow?.explicit && !recurrenceFlow.untilDateProvided)
          return 'Não crie a tarefa ainda. Pergunte apenas até qual data a recorrência deve ser mantida.';
        if (recurrenceFlow?.explicit && !recurrence)
          return 'Esta tarefa foi informada como recorrente. Não a crie sem preencher recurrence com frequência e data final.';
        if (recurrence && due_date && recurrence.until_date < due_date)
          return 'A data final da recorrência não pode ser anterior ao prazo inicial.';
        try {
          const user = await deps.getUserBySubject(subject);
          if (!user) return FAIL;
          const t = await deps.addTask(
            user.id,
            title,
            due_date,
            recurrence
              ? {
                  unit: recurrence.unit,
                  interval: recurrence.interval,
                  untilDate: recurrence.until_date,
                }
              : undefined,
          );
          return `Tarefa criada para ${user.name}: "${t.title}"${t.dueDate ? ` (prazo ${t.dueDate})` : ''}${t.recurrence ? `, recorrente até ${t.recurrence.untilDate}` : ''}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_complete: tool({
      description: 'Marca uma tarefa como concluída (use o id retornado por tasks_list).',
      inputSchema: z.object({ task_id: z.string() }),
      execute: async ({ task_id }) => {
        try {
          await deps.completeTask(task_id);
          return 'Tarefa concluída. 🎉';
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_update: tool({
      description: 'Altera título e/ou prazo de uma tarefa (due_date null remove o prazo).',
      inputSchema: z.object({
        task_id: z.string(),
        title: z.string().optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      execute: async ({ task_id, title, due_date }) => {
        if (title === undefined && due_date === undefined)
          return 'Nada para atualizar — informe título e/ou prazo.';
        try {
          await deps.updateTask(task_id, { title, dueDate: due_date });
          return 'Tarefa atualizada.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
