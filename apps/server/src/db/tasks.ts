import { supabase } from './client.js';

export type Task = { id: string; title: string; status: 'open' | 'done'; dueDate: string | null };

function toTask(r: { id: string; title: string; status: string; due_date: string | null }): Task {
  return { id: r.id, title: r.title, status: r.status as Task['status'], dueDate: r.due_date };
}

export async function listTasks(userId: string, status?: 'open' | 'done'): Promise<Task[]> {
  let q = supabase
    .from('tasks')
    .select('id, title, status, due_date')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toTask);
}

export async function addTask(userId: string, title: string, dueDate?: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ user_id: userId, title, due_date: dueDate ?? null })
    .select('id, title, status, due_date')
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
