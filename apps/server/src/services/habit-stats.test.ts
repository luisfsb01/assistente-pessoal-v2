import { describe, expect, it } from 'vitest';
import type { Habit, HabitCheckin } from '../db/habits.js';
import { monthProgress, prevMonthRange, prevWeekRange, weekProgress, weekStart } from './habit-stats.js';

const h = (id: string, name: string, target: number): Habit => ({ id, name, targetPerWeek: target });
const c = (habitId: string, date: string, done = true): HabitCheckin => ({ habitId, date, done });

describe('weekStart (segunda-feira)', () => {
  it.each([
    ['2026-07-16', '2026-07-13'], // quinta → segunda
    ['2026-07-13', '2026-07-13'], // segunda → ela mesma
    ['2026-07-19', '2026-07-13'], // domingo → segunda anterior
  ])('%s → %s', (d, expected) => expect(weekStart(d)).toBe(expected));
});

describe('prevWeekRange / prevMonthRange', () => {
  it('semana anterior: segunda a domingo', () => {
    expect(prevWeekRange('2026-07-16')).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });
  it('mês anterior: primeiro a último dia', () => {
    expect(prevMonthRange('2026-07-01')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(prevMonthRange('2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('weekProgress', () => {
  it('conta só done=true dentro da janela; meta = meta semanal', () => {
    const habits = [h('h1', 'Academia', 3)];
    const checkins = [
      c('h1', '2026-07-13'),
      c('h1', '2026-07-14', false), // não fez: não conta
      c('h1', '2026-07-12'), // fora da janela
    ];
    expect(weekProgress(habits, checkins, '2026-07-13', '2026-07-19')).toEqual([
      { name: 'Academia', done: 1, target: 3 },
    ]);
  });
});

describe('monthProgress', () => {
  it('meta do mês proporcional aos dias (3x/sem em junho ≈ 13)', () => {
    const habits = [h('h1', 'Academia', 3)];
    const out = monthProgress(habits, [c('h1', '2026-06-10')], '2026-06-01', '2026-06-30');
    expect(out).toEqual([{ name: 'Academia', done: 1, target: 13 }]);
  });
});
