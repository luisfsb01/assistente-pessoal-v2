import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildProjectTools, type ProjectToolDeps } from './projects.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const proj = { id: 'p1', name: 'Site', status: 'em andamento', updatedAt: '2026-07-10T00:00:00Z' };

function deps(over: Partial<ProjectToolDeps> = {}) {
  const notes: Array<{ kind: string; content: string }> = [];
  const moved: Array<{ taskId: string; status: string }> = [];
  const d: ProjectToolDeps = {
    getUserBySubject: async () => ({ id: 'u1', name: 'Luis', calendarId: null }) as never,
    createProject: async (_u, name) => ({ ...proj, id: 'p9', name }),
    findProjectByName: async (_u, name) => (name.toLowerCase().includes('site') ? proj : null),
    listActiveProjects: async () => [proj],
    setProjectStatus: async () => undefined,
    addProjectNote: async (_p, kind, content) => void notes.push({ kind, content }),
    listRecentNotes: async () => [{ kind: 'decision', content: 'usar Astro', createdAt: '2026-07-10T12:00:00Z' }],
    addProjectTask: async (_p, title, dueDate) => ({ id: 't1', projectId: 'p1', title, status: 'todo', dueDate: dueDate ?? null }),
    moveProjectTask: async (taskId, status) => void moved.push({ taskId, status }),
    listProjectTasks: async () => [
      { id: 't1', projectId: 'p1', title: 'wireframe', status: 'doing', dueDate: '2026-07-18' },
    ],
    archiveProject: async () => undefined,
    ...over,
  };
  return { d, notes, moved };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  const t = toolset[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('project_note', () => {
  it('registra decisão na linha do tempo do projeto achado por nome', async () => {
    const { d, notes } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_note', {
      project_name: 'site',
      kind: 'decision',
      content: 'usar Astro',
    });
    expect(notes).toEqual([{ kind: 'decision', content: 'usar Astro' }]);
    expect(out).toContain('Site');
  });
  it('projeto não achado sugere criar', async () => {
    const { d } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_note', {
      project_name: 'loja',
      kind: 'note',
      content: 'x',
    });
    expect(out).toContain('Não achei');
  });
});

describe('project_set_status', () => {
  it('grava status e nota kind=status', async () => {
    const { d, notes } = deps();
    await run(buildProjectTools(luis, d) as never, 'project_set_status', {
      project_name: 'Site',
      status: 'aguardando cliente',
    });
    expect(notes).toEqual([{ kind: 'status', content: 'aguardando cliente' }]);
  });
});

describe('project_overview', () => {
  it('devolve status, notas com dd/mm e quadro por coluna', async () => {
    const { d } = deps();
    const out = JSON.parse(await run(buildProjectTools(luis, d) as never, 'project_overview', { project_name: 'Site' }));
    expect(out.projeto).toBe('Site');
    expect(out.status).toBe('em andamento');
    expect(out.notas[0]).toEqual({ kind: 'decision', content: 'usar Astro', quando: '10/07' });
    expect(out.tarefas.doing).toEqual([{ id: 't1', titulo: 'wireframe', prazo: '18/07' }]);
    expect(out.tarefas.todo).toEqual([]);
  });
});

describe('project_task_add / move', () => {
  it('cria tarefa com prazo e move por id', async () => {
    const { d, moved } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_task_add', {
      project_name: 'Site',
      title: 'enviar proposta',
      due_date: '2026-07-18',
    });
    expect(out).toContain('enviar proposta');
    await run(buildProjectTools(luis, d) as never, 'project_task_move', { task_id: 't1', status: 'done' });
    expect(moved).toEqual([{ taskId: 't1', status: 'done' }]);
  });
});
