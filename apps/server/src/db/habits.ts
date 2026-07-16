import { supabase } from './client.js';

export type Habit = { id: string; name: string; targetPerWeek: number };
export type HabitCheckin = { habitId: string; date: string; done: boolean };

const COLS = 'id, name, target_per_week';

function toHabit(r: { id: string; name: string; target_per_week: number }): Habit {
  return { id: r.id, name: r.name, targetPerWeek: r.target_per_week };
}

export async function listActiveHabits(userId: string): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select(COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toHabit);
}

export async function getHabitById(id: string): Promise<Habit | null> {
  const { data, error } = await supabase.from('habits').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toHabit(data) : null;
}

export async function createHabit(userId: string, name: string, targetPerWeek: number): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .insert({ user_id: userId, name, target_per_week: targetPerWeek })
    .select(COLS)
    .single();
  if (error) throw error;
  return toHabit(data);
}

export async function archiveHabit(habitId: string): Promise<void> {
  const { error } = await supabase.from('habits').update({ active: false }).eq('id', habitId);
  if (error) throw error;
}

export async function getCheckin(habitId: string, date: string): Promise<{ done: boolean } | null> {
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('done')
    .eq('habit_id', habitId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data ? { done: Boolean(data.done) } : null;
}

/** Um registro por hábito/dia; reclique atualiza (unique habit_id+date). */
export async function upsertCheckin(habitId: string, date: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('habit_checkins')
    .upsert({ habit_id: habitId, date, done }, { onConflict: 'habit_id,date' });
  if (error) throw error;
}

export async function listCheckinsBetween(habitIds: string[], from: string, to: string): Promise<HabitCheckin[]> {
  if (habitIds.length === 0) return [];
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('habit_id, date, done')
    .in('habit_id', habitIds)
    .gte('date', from)
    .lte('date', to);
  if (error) throw error;
  return (data ?? []).map((r) => ({ habitId: r.habit_id as string, date: r.date as string, done: Boolean(r.done) }));
}

/** Hábitos ativos SEM registro no dia (a fila do check-in das 21:00). */
export async function pendingHabitsFor(userId: string, date: string): Promise<Habit[]> {
  const habits = await listActiveHabits(userId);
  if (habits.length === 0) return [];
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('habit_id')
    .eq('date', date)
    .in('habit_id', habits.map((h) => h.id));
  if (error) throw error;
  const answered = new Set((data ?? []).map((r) => r.habit_id as string));
  return habits.filter((h) => !answered.has(h.id));
}
