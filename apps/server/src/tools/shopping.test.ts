import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildShoppingTools, type ShoppingToolDeps } from './shopping.js';

const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const deps: ShoppingToolDeps = {
    getUserBySubject: async (s) => ({ id: `uid-${s}`, name: s, calendarId: null }),
    listItems: async () => [{ id: 'i1', name: 'Leite' }],
    addItems: async (names, by) => {
      calls.push(`add:${names.join(',')}:${by ?? 'null'}`);
    },
    removeItem: async (id) => {
      calls.push(`rm:${id}`);
    },
    clearItems: async () => {
      calls.push('clear');
    },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildShoppingTools', () => {
  it('adiciona vários itens de uma vez', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildShoppingTools(grupo, deps), 'shopping_add', {
      items: ['Leite', 'Ovos'],
    });
    expect(calls).toEqual(['add:Leite,Ovos:null']);
    expect(out).toContain('2');
  });

  it('lista itens', async () => {
    const { deps } = makeDeps();
    const out = await exec(buildShoppingTools(grupo, deps), 'shopping_list', {});
    expect(out).toContain('Leite');
  });
});
