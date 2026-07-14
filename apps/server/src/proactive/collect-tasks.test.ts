import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { TaskWithAge } from '../db/tasks.js';
import { collectTaskEvents, selectTaskEvents, type TaskCollectorDeps } from './collect-tasks.js';

const task = (over: Partial<TaskWithAge>): TaskWithAge => ({
  id: 't1',
  title: 'Tarefa',
  status: 'open',
  dueDate: null,
  createdAt: '2026-07-01T12:00:00Z',
  ...over,
});

describe('selectTaskEvents', () => {
  it('atrasada: prazo no passado, dedupe por prazo', () => {
    const out = selectTaskEvents([task({ id: 'a', dueDate: '2026-07-10' })], '2026-07-14');
    expect(out).toEqual([
      { kind: 'task_overdue', task: expect.objectContaining({ id: 'a' }), dedupeKey: 'task:overdue:a:2026-07-10' },
    ]);
  });
  it('prazo hoje ou futuro não é atrasada', () => {
    expect(selectTaskEvents([task({ dueDate: '2026-07-14' })], '2026-07-14')).toEqual([]);
    expect(selectTaskEvents([task({ dueDate: '2026-07-20' })], '2026-07-14')).toEqual([]);
  });
  it('parada: sem prazo, >= 7 dias aberta, bucket semanal no dedupe', () => {
    const out = selectTaskEvents([task({ id: 'b', createdAt: '2026-07-01T12:00:00Z' })], '2026-07-14');
    expect(out).toEqual([
      { kind: 'task_stale', task: expect.objectContaining({ id: 'b' }), dedupeKey: 'task:stale:b:w1' },
    ]);
    // com 15 dias, bucket muda para w2 (re-emite semanalmente)
    expect(selectTaskEvents([task({ id: 'b', createdAt: '2026-07-01T12:00:00Z' })], '2026-07-16')[0].dedupeKey).toBe(
      'task:stale:b:w2',
    );
  });
  it('aberta há menos de 7 dias sem prazo não emite', () => {
    expect(selectTaskEvents([task({ createdAt: '2026-07-10T12:00:00Z' })], '2026-07-14')).toEqual([]);
  });
});

describe('collectTaskEvents', () => {
  it('emite para os dois usuários com nome no summary', async () => {
    const inserted: Array<{ summary: string; dedupeKey: string }> = [];
    const deps: TaskCollectorDeps = {
      getUserBySubject: async (s) =>
        s === 'luis'
          ? ({ id: 'u1', name: 'Luis', calendarId: null, telegramChatId: 1 } as never)
          : ({ id: 'u2', name: 'Esposa', calendarId: null, telegramChatId: 2 } as never),
      listOpenTasksWithAge: async (userId) =>
        userId === 'u1' ? [task({ id: 'a', dueDate: '2026-07-10', title: 'Pagar boleto' })] : [],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e' } as never;
      },
      todayIso: () => '2026-07-14',
    };
    const n = await collectTaskEvents(deps);
    expect(n).toBe(1);
    expect(inserted[0].summary).toContain('Luis');
    expect(inserted[0].summary).toContain('Pagar boleto');
    expect(inserted[0].summary).toContain('10/07');
  });
});
