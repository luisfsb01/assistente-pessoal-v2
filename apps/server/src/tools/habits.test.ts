import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildHabitTools, type HabitToolDeps } from './habits.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function deps(over: Partial<HabitToolDeps> = {}) {
  const created: Array<{ name: string; target: number }> = [];
  const checkins: Array<{ habitId: string; date: string; done: boolean }> = [];
  const d: HabitToolDeps = {
    getUserBySubject: async () => ({ id: 'u1', name: 'Luis', calendarId: null }) as never,
    listActiveHabits: async () => [{ id: 'h1', name: 'Academia', targetPerWeek: 3 }],
    createHabit: async (_u, name, target) => {
      created.push({ name, target });
      return { id: 'h9', name, targetPerWeek: target };
    },
    archiveHabit: async () => undefined,
    upsertCheckin: async (habitId, date, done) => void checkins.push({ habitId, date, done }),
    listCheckinsBetween: async () => [{ habitId: 'h1', date: '2026-07-14', done: true }],
    todayIso: () => '2026-07-16',
    ...over,
  };
  return { d, created, checkins };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  const t = toolset[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('habit_define', () => {
  it('cria hábito com meta semanal', async () => {
    const { d, created } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_define', { name: 'Leitura', target_per_week: 5 });
    expect(created).toEqual([{ name: 'Leitura', target: 5 }]);
    expect(out).toContain('Leitura');
  });
});

describe('habit_list', () => {
  it('lista com progresso da semana corrente', async () => {
    const { d } = deps();
    const out = JSON.parse(await run(buildHabitTools(luis, d) as never, 'habit_list', {}));
    expect(out[0]).toEqual({ id: 'h1', habito: 'Academia', semana: '1/3' });
  });
});

describe('habit_checkin', () => {
  it('registra pelo nome (match case-insensitive), hoje por padrão', async () => {
    const { d, checkins } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_checkin', { habit_name: 'academia', done: true });
    expect(checkins).toEqual([{ habitId: 'h1', date: '2026-07-16', done: true }]);
    expect(out).toContain('Academia');
  });
  it('hábito desconhecido avisa sem quebrar', async () => {
    const { d, checkins } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_checkin', { habit_name: 'yoga', done: true });
    expect(checkins).toEqual([]);
    expect(out).toContain('não achei');
  });
});

describe('sem subject (grupo sem dono)', () => {
  it('pede para especificar a pessoa', async () => {
    const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };
    const { d } = deps();
    const out = await run(buildHabitTools(grupo, d) as never, 'habit_list', {});
    expect(out).toContain('de quem');
  });
});
