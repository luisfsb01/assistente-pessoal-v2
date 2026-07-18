import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject, type UserRecord } from '../db/chats.js';
import {
  addPrayerRequest,
  addTravelItems,
  deleteTravelList,
  listPrayerRequests,
  listTravelLists,
  removePrayerRequest,
  removeTravelItem,
} from '../db/lists.js';

export type ListToolDeps = {
  getUserBySubject: (subject: 'luis' | 'esposa') => Promise<UserRecord | null>;
  listTravelLists: typeof listTravelLists;
  addTravelItems: typeof addTravelItems;
  removeTravelItem: typeof removeTravelItem;
  deleteTravelList: typeof deleteTravelList;
  listPrayerRequests: typeof listPrayerRequests;
  addPrayerRequest: typeof addPrayerRequest;
  removePrayerRequest: typeof removePrayerRequest;
};

const defaultDeps: ListToolDeps = {
  getUserBySubject,
  listTravelLists,
  addTravelItems,
  removeTravelItem,
  deleteTravelList,
  listPrayerRequests,
  addPrayerRequest,
  removePrayerRequest,
};

const FAIL = 'Não consegui acessar as listas agora. Tenta de novo em instantes.';
const NO_OWNER = 'Não consegui identificar de quem é a lista de oração neste chat.';

async function currentUser(identity: ChatIdentity, deps: ListToolDeps): Promise<UserRecord | null> {
  return identity.subject ? deps.getUserBySubject(identity.subject) : null;
}

export function buildListTools(identity: ChatIdentity, deps: ListToolDeps = defaultDeps): ToolSet {
  return {
    travel_list: tool({
      description: 'Lista as viagens compartilhadas do casal e os itens que não podem ser esquecidos.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const lists = await deps.listTravelLists();
          return lists.length === 0 ? 'Não há listas de viagem.' : JSON.stringify(lists);
        } catch {
          return FAIL;
        }
      },
    }),
    travel_add: tool({
      description:
        'Adiciona itens a uma viagem compartilhada. Só chame depois de saber o nome da viagem e a data no formato YYYY-MM-DD.',
      inputSchema: z.object({
        travel_name: z.string().min(1),
        travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        items: z.array(z.string().min(1)).min(1),
      }),
      execute: async ({ travel_name, travel_date, items }) => {
        try {
          const user = await currentUser(identity, deps);
          await deps.addTravelItems({
            travelName: travel_name,
            travelDate: travel_date,
            items,
            addedByUserId: user?.id ?? null,
          });
          return `${items.length} item(ns) adicionados à viagem ${travel_name}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    travel_remove_item: tool({
      description: 'Remove um item de viagem (use o id retornado por travel_list).',
      inputSchema: z.object({ item_id: z.string().uuid() }),
      execute: async ({ item_id }) => {
        try {
          await deps.removeTravelItem(item_id);
          return 'Item removido da viagem.';
        } catch {
          return FAIL;
        }
      },
    }),
    travel_delete: tool({
      description:
        'Apaga uma lista de viagem inteira. Confirme com o usuário antes; use o id retornado por travel_list.',
      inputSchema: z.object({ travel_list_id: z.string().uuid() }),
      execute: async ({ travel_list_id }) => {
        try {
          return (await deps.deleteTravelList(travel_list_id))
            ? 'Lista de viagem apagada.'
            : 'Lista de viagem não encontrada.';
        } catch {
          return FAIL;
        }
      },
    }),
    prayer_list: tool({
      description: 'Lista os pedidos de oração individuais do dono deste chat, agrupáveis por propósito.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const user = await currentUser(identity, deps);
          if (!user) return NO_OWNER;
          const requests = await deps.listPrayerRequests(user.id);
          return requests.length === 0 ? 'Sua lista de pedidos de oração está vazia.' : JSON.stringify(requests);
        } catch {
          return FAIL;
        }
      },
    }),
    prayer_add: tool({
      description:
        'Adiciona um pedido à lista individual do dono do chat. Nome da pessoa e pedido são obrigatórios; propósito é opcional (sem propósito = lista geral).',
      inputSchema: z.object({
        person_name: z.string().min(1),
        request: z.string().min(1),
        purpose: z.string().min(1).optional(),
      }),
      execute: async ({ person_name, request, purpose }) => {
        try {
          const user = await currentUser(identity, deps);
          if (!user) return NO_OWNER;
          await deps.addPrayerRequest({ ownerId: user.id, personName: person_name, request, purpose });
          return 'Pedido de oração adicionado à sua lista.';
        } catch {
          return FAIL;
        }
      },
    }),
    prayer_remove: tool({
      description: 'Remove um pedido da lista individual do dono do chat (use o id retornado por prayer_list).',
      inputSchema: z.object({ request_id: z.string().uuid() }),
      execute: async ({ request_id }) => {
        try {
          const user = await currentUser(identity, deps);
          if (!user) return NO_OWNER;
          return (await deps.removePrayerRequest(request_id, user.id))
            ? 'Pedido de oração removido.'
            : 'Pedido não encontrado na sua lista.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
