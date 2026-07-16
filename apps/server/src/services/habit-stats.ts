import type { Habit, HabitCheckin } from '../db/habits.js';
import { addDays } from '../lib/dates.js';

/** PURA: segunda-feira da semana que contém a data. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  return addDays(isoDate, -(dow === 0 ? 6 : dow - 1));
}

/** PURA: segunda a domingo da semana ANTERIOR. */
export function prevWeekRange(today: string): { from: string; to: string } {
  const ws = weekStart(today);
  return { from: addDays(ws, -7), to: addDays(ws, -1) };
}

/** PURA: primeiro a último dia do mês ANTERIOR. */
export function prevMonthRange(today: string): { from: string; to: string } {
  const firstThis = `${today.slice(0, 7)}-01`;
  const lastPrev = addDays(firstThis, -1);
  return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
}

export type HabitProgress = { name: string; done: number; target: number };

function countDone(habitId: string, checkins: HabitCheckin[], from: string, to: string): number {
  return checkins.filter((c) => c.habitId === habitId && c.done && c.date >= from && c.date <= to).length;
}

/** PURA: progresso numa janela semanal — meta = meta semanal do hábito. */
export function weekProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[] {
  return habits.map((h) => ({ name: h.name, done: countDone(h.id, checkins, from, to), target: h.targetPerWeek }));
}

/** PURA: progresso numa janela mensal — meta proporcional aos dias da janela. */
export function monthProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[] {
  const days = Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  return habits.map((h) => ({
    name: h.name,
    done: countDone(h.id, checkins, from, to),
    target: Math.round((h.targetPerWeek * days) / 7),
  }));
}
