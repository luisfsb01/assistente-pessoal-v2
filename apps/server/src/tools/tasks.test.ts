import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildTaskTools, type TaskToolDeps } from './tasks.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const deps: TaskToolDeps = {
    getUserBySubject: async (s) => ({ id: `uid-${s}`, name: s, calendarId: null }),
    listTasks: async (uid) => {
      calls.push(`list:${uid}`);
      return [{ id: 't1', title: 'Pagar boleto', status: 'open', dueDate: '2026-07-15' }];
    },
    addTask: async (uid, title, due) => {
      calls.push(`add:${uid}:${title}:${due ?? '-'}`);
      return { id: 't2', title, status: 'open', dueDate: due ?? null };
    },
    completeTask: async (id) => {
      calls.push(`done:${id}`);
    },
    updateTask: async (id, patch) => {
      calls.push(`upd:${id}:${JSON.stringify(patch)}`);
    },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildTaskTools', () => {
  it('privado: owner default é o dono do chat', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_add', { title: 'Comprar ração' });
    expect(calls).toEqual(['add:uid-luis:Comprar ração:-']);
    expect(out).toContain('Comprar ração');
  });

  it('grupo sem owner: pede para especificar', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', {});
    expect(calls).toEqual([]);
    expect(out.toLowerCase()).toContain('de quem');
  });

  it('grupo com owner explícito funciona', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', { owner: 'esposa' });
    expect(calls).toEqual(['list:uid-esposa']);
    expect(out).toContain('Pagar boleto');
  });

  it('erro do repo vira mensagem amigável', async () => {
    const { deps } = makeDeps();
    deps.listTasks = async () => {
      throw new Error('boom');
    };
    const out = await exec(buildTaskTools(luis, deps), 'tasks_list', {});
    expect(out.toLowerCase()).toContain('não consegui');
  });
});
