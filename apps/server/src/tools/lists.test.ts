import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildListTools, type ListToolDeps } from './lists.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function makeDeps() {
  const calls: string[] = [];
  const deps: ListToolDeps = {
    getUserBySubject: async (subject) => ({ id: `uid-${subject}`, name: subject, calendarId: null }),
    listTravelLists: async () => [{
      id: '11111111-1111-4111-8111-111111111111', name: 'Recife', travelDate: '2026-08-20', cleanupPromptedAt: null,
      items: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Carregador' }],
    }],
    addTravelItems: async (args) => { calls.push(`travel:${args.travelName}:${args.travelDate}:${args.items.join(',')}:${args.addedByUserId}`); return 'list'; },
    removeTravelItem: async (id) => { calls.push(`travel-rm:${id}`) },
    deleteTravelList: async (id) => { calls.push(`travel-del:${id}`); return true },
    listPrayerRequests: async (owner) => [{ id: 'p1', purpose: null, personName: 'Ana', request: `Saúde ${owner}` }],
    addPrayerRequest: async (args) => { calls.push(`prayer:${args.ownerId}:${args.personName}:${args.request}:${args.purpose ?? 'geral'}`) },
    removePrayerRequest: async (id, owner) => { calls.push(`prayer-rm:${id}:${owner}`); return true },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildListTools', () => {
  it('adiciona item de viagem com viagem, data e autor', async () => {
    const { deps, calls } = makeDeps();
    await exec(buildListTools(luis, deps), 'travel_add', {
      travel_name: 'Recife', travel_date: '2026-08-20', items: ['Carregador'],
    });
    expect(calls).toEqual(['travel:Recife:2026-08-20:Carregador:uid-luis']);
  });

  it('lista as viagens compartilhadas', async () => {
    const { deps } = makeDeps();
    const result = await exec(buildListTools(luis, deps), 'travel_list', {});
    expect(result).toContain('Recife');
    expect(result).toContain('Carregador');
  });

  it('grava pedido de oração somente no dono identificado', async () => {
    const { deps, calls } = makeDeps();
    await exec(buildListTools(luis, deps), 'prayer_add', {
      person_name: 'Ana', request: 'Saúde', purpose: 'Família',
    });
    expect(calls).toEqual(['prayer:uid-luis:Ana:Saúde:Família']);
  });

  it('não acessa pedidos quando não consegue identificar o dono', async () => {
    const { deps, calls } = makeDeps();
    const anonymousGroup: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };
    const result = await exec(buildListTools(anonymousGroup, deps), 'prayer_add', {
      person_name: 'Ana', request: 'Saúde',
    });
    expect(result).toContain('identificar');
    expect(calls).toEqual([]);
  });
});
