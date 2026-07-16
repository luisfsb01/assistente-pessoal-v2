import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import {
  registerHabitAnswer,
  runDailyCheckin,
  sendNextCheckinQuestion,
  type CheckinDeps,
} from './daily-checkin.js';

type Sent = Array<{ chatId: number; text: string; kb: boolean }>;

function deps(over: Partial<CheckinDeps> = {}) {
  const upserts: Array<{ habitId: string; date: string; done: boolean }> = [];
  const d: CheckinDeps = {
    getUserBySubject: async (s) => (s === 'luis' ? ({ id: 'u1', name: 'Luis', calendarId: null } as never) : null),
    getSubjectChatId: async (s) => (s === 'luis' ? 111 : null),
    pendingHabitsFor: async () => [{ id: 'h1', name: 'Academia', targetPerWeek: 3 }],
    getCheckin: async () => null,
    upsertCheckin: async (habitId, date, done) => void upserts.push({ habitId, date, done }),
    listOverdueProjectTasks: async () => [],
    todayIso: () => '2026-07-16',
    ...over,
  };
  return { d, upserts };
}

function collector(): { send: (chatId: number, text: string, kb?: unknown) => Promise<void>; sent: Sent } {
  const sent: Sent = [];
  return { sent, send: async (chatId, text, kb) => void sent.push({ chatId, text, kb: kb !== undefined }) };
}

describe('runDailyCheckin', () => {
  it('manda SÓ a primeira pergunta de hábito pendente, com botões', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [
        { id: 'h1', name: 'Academia', targetPerWeek: 3 },
        { id: 'h2', name: 'Leitura', targetPerWeek: 5 },
      ],
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: 111, kb: true });
    expect(sent[0].text).toContain('Academia');
  });

  it('sem pendência nenhuma = silêncio', async () => {
    const { d } = deps({ pendingHabitsFor: async () => [] });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(0);
  });

  it('sem hábito pendente mas com tarefas vencidas: manda o lote (cap 5)', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [],
      listOverdueProjectTasks: async () =>
        Array.from({ length: 7 }, (_, i) => ({
          id: `t${i}`,
          projectId: 'p1',
          title: `tarefa ${i}`,
          status: 'todo' as const,
          dueDate: '2026-07-10',
          projectName: 'Site',
        })),
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(5);
    expect(sent[0].text).toContain('Site');
    expect(sent[0].text).toContain('10/07');
    expect(sent.every((s) => s.kb)).toBe(true);
  });

  it('falha de um usuário não derruba o outro', async () => {
    const { d } = deps({
      getUserBySubject: async (s) => {
        if (s === 'luis') throw new Error('boom');
        return { id: 'u2', name: 'Esposa', calendarId: null } as never;
      },
      getSubjectChatId: async () => 222,
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(1); // só a esposa recebeu
    expect(sent[0].chatId).toBe(222);
  });
});

describe('registerHabitAnswer (idempotência)', () => {
  it('novo registra e retorna novo', async () => {
    const { d, upserts } = deps();
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('novo');
    expect(upserts).toEqual([{ habitId: 'h1', date: '2026-07-16', done: true }]);
  });
  it('reclique com o mesmo valor não grava e retorna repetido', async () => {
    const { d, upserts } = deps({ getCheckin: async () => ({ done: true }) });
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('repetido');
    expect(upserts).toEqual([]);
  });
  it('mudança de valor grava e retorna alterado (não avança)', async () => {
    const { d, upserts } = deps({ getCheckin: async () => ({ done: false }) });
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('alterado');
    expect(upserts).toHaveLength(1);
  });
});

describe('sendNextCheckinQuestion', () => {
  it('com hábito pendente pergunta o hábito; sem, cai nas tarefas vencidas', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [],
      listOverdueProjectTasks: async () => [
        { id: 't1', projectId: 'p1', title: 'proposta', status: 'todo' as const, dueDate: '2026-07-10', projectName: 'Site' },
      ],
    });
    const { send, sent } = collector();
    await sendNextCheckinQuestion('u1', 111, send, d);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('proposta');
  });
});
