import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { collectProjectEvents, type ProjectCollectorDeps } from './collect-projects.js';

function deps(over: Partial<ProjectCollectorDeps> = {}) {
  const inserted: Array<{ kind: string; dedupeKey: string; summary: string }> = [];
  const d: ProjectCollectorDeps = {
    getUserBySubject: async (s) => (s === 'luis' ? ({ id: 'u1', name: 'Luis', calendarId: null } as never) : null),
    listActiveProjects: async () => [],
    insertEvent: async (e) => {
      inserted.push(e as never);
      return { id: 'e1' } as never;
    },
    todayIso: () => '2026-07-16', // quinta; segunda = 2026-07-13
    ...over,
  };
  return { d, inserted };
}

describe('collectProjectEvents', () => {
  it('projeto parado há >=10 dias vira evento com dedupe semanal', async () => {
    const { d, inserted } = deps({
      listActiveProjects: async () => [
        { id: 'p1', name: 'Site', status: null, updatedAt: '2026-07-01T10:00:00Z' }, // 15 dias
        { id: 'p2', name: 'Loja', status: null, updatedAt: '2026-07-14T10:00:00Z' }, // 2 dias: não
      ],
    });
    expect(await collectProjectEvents(d)).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].kind).toBe('project_stale');
    expect(inserted[0].dedupeKey).toBe('proj:stale:p1:2026-07-13');
    expect(inserted[0].summary).toContain('Site');
    expect(inserted[0].summary).toContain('15 dias');
  });

  it('dedupe repetido não conta; falha de um usuário não derruba o outro', async () => {
    const { d } = deps({
      getUserBySubject: async (s) => {
        if (s === 'luis') throw new Error('boom');
        return { id: 'u2', name: 'Esposa', calendarId: null } as never;
      },
      listActiveProjects: async () => [{ id: 'p1', name: 'X', status: null, updatedAt: '2026-07-01T00:00:00Z' }],
      insertEvent: async () => null, // já existia
    });
    expect(await collectProjectEvents(d)).toBe(0);
  });
});
