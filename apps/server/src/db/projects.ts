import { supabase } from './client.js';
import { escapeLikePattern } from '../lib/postgrest.js';

export type Project = { id: string; name: string; status: string | null; updatedAt: string };
export type ProjectTask = {
  id: string;
  projectId: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  dueDate: string | null;
};
export type ProjectNote = { kind: 'status' | 'decision' | 'note'; content: string; createdAt: string };

const P_COLS = 'id, name, status, updated_at';
const T_COLS = 'id, project_id, title, status, due_date';

function toProject(r: { id: string; name: string; status: string | null; updated_at: string }): Project {
  return { id: r.id, name: r.name, status: r.status, updatedAt: r.updated_at };
}

function toTask(r: { id: string; project_id: string; title: string; status: string; due_date: string | null }): ProjectTask {
  return { id: r.id, projectId: r.project_id, title: r.title, status: r.status as ProjectTask['status'], dueDate: r.due_date };
}

/** Toda escrita em projeto passa por aqui: base do "projeto parado". */
async function touchProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
  if (error) throw error;
}

export async function createProject(userId: string, name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert({ user_id: userId, name }).select(P_COLS).single();
  if (error) throw error;
  return toProject(data);
}

export async function findProjectByName(userId: string, name: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(P_COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .ilike('name', `%${escapeLikePattern(name)}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function listActiveProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(P_COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toProject);
}

export async function archiveProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ active: false }).eq('id', projectId);
  if (error) throw error;
}

export async function setProjectStatus(projectId: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw error;
}

export async function addProjectNote(projectId: string, kind: ProjectNote['kind'], content: string): Promise<void> {
  const { error } = await supabase.from('project_notes').insert({ project_id: projectId, kind, content });
  if (error) throw error;
  await touchProject(projectId);
}

export async function listRecentNotes(projectId: string, limit = 5): Promise<ProjectNote[]> {
  const { data, error } = await supabase
    .from('project_notes')
    .select('kind, content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ kind: r.kind as ProjectNote['kind'], content: r.content as string, createdAt: r.created_at as string }));
}

export async function addProjectTask(projectId: string, title: string, dueDate?: string): Promise<ProjectTask> {
  const { data, error } = await supabase
    .from('project_tasks')
    .insert({ project_id: projectId, title, due_date: dueDate ?? null })
    .select(T_COLS)
    .single();
  if (error) throw error;
  await touchProject(projectId);
  return toTask(data);
}

export async function moveProjectTask(taskId: string, status: ProjectTask['status']): Promise<void> {
  const { data, error } = await supabase
    .from('project_tasks')
    .update({ status, done_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', taskId)
    .select('project_id')
    .single();
  if (error) throw error;
  await touchProject(data.project_id as string);
}

export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select(T_COLS)
    .eq('project_id', projectId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTask);
}

/** Tarefas de projeto vencidas do usuário (para o check-in das 21:00). */
export async function listOverdueProjectTasks(
  userId: string,
  today: string,
): Promise<Array<ProjectTask & { projectName: string }>> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select(`${T_COLS}, projects!inner(name, user_id, active)`)
    .neq('status', 'done')
    .lt('due_date', today)
    .eq('projects.user_id', userId)
    .eq('projects.active', true)
    .order('due_date', { ascending: true });
  if (error) throw error;
  // O supabase-js tipa o embed como array, mas em relação many-to-one o
  // PostgREST devolve OBJETO em runtime — cast via unknown para refletir isso.
  return (data ?? []).map((r) => ({
    ...toTask(r as never),
    projectName: (r as unknown as { projects: { name: string } }).projects.name,
  }));
}

/** Ações abertas de projetos ativos com prazo exatamente na data informada. */
export async function listProjectTasksDueOn(
  userId: string,
  date: string,
): Promise<Array<ProjectTask & { projectName: string }>> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select(`${T_COLS}, projects!inner(name, user_id, active)`)
    .neq('status', 'done')
    .eq('due_date', date)
    .eq('projects.user_id', userId)
    .eq('projects.active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...toTask(r as never),
    projectName: (r as unknown as { projects: { name: string } }).projects.name,
  }));
}
