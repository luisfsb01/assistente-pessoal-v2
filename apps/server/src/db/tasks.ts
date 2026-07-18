import { supabase } from './client.js';

export type TaskRecurrence = {
  unit: 'day' | 'week' | 'month';
  interval: number;
  untilDate: string;
};

export type Task = {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueDate: string | null;
  recurrence: TaskRecurrence | null;
};

const TASK_COLUMNS =
  'id, title, status, due_date, recurrence_unit, recurrence_interval, recurrence_until';

function toTask(r: {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  recurrence_unit: string | null;
  recurrence_interval: number | null;
  recurrence_until: string | null;
}): Task {
  const recurrence =
    r.recurrence_unit && r.recurrence_interval && r.recurrence_until
      ? {
          unit: r.recurrence_unit as TaskRecurrence['unit'],
          interval: r.recurrence_interval,
          untilDate: r.recurrence_until,
        }
      : null;
  return {
    id: r.id,
    title: r.title,
    status: r.status as Task['status'],
    dueDate: r.due_date,
    recurrence,
  };
}

export async function listTasks(userId: string, status?: 'open' | 'done'): Promise<Task[]> {
  let q = supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toTask);
}

export async function addTask(
  userId: string,
  title: string,
  dueDate?: string,
  recurrence?: TaskRecurrence,
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title,
      due_date: dueDate ?? null,
      recurrence_unit: recurrence?.unit ?? null,
      recurrence_interval: recurrence?.interval ?? null,
      recurrence_until: recurrence?.untilDate ?? null,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;
  return toTask(data);
}

export async function completeTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw error;
}

export async function updateTask(
  taskId: string,
  patch: { title?: string; dueDate?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  const { error } = await supabase.from('tasks').update(row).eq('id', taskId);
  if (error) throw error;
}

export type TaskWithAge = Task & { createdAt: string };

/** Tarefas abertas com created_at (para detectar tarefa parada). */
export async function listOpenTasksWithAge(userId: string): Promise<TaskWithAge[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(`${TASK_COLUMNS}, created_at`)
    .eq('user_id', userId)
    .eq('status', 'open');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...toTask(r), createdAt: r.created_at as string }));
}
