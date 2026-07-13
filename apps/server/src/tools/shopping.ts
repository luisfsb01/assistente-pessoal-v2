import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject, type UserRecord } from '../db/chats.js';
import { addItems, clearItems, listItems, removeItem } from '../db/shopping.js';

export type ShoppingToolDeps = {
  getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>;
  listItems: typeof listItems;
  addItems: typeof addItems;
  removeItem: typeof removeItem;
  clearItems: typeof clearItems;
};

const defaultDeps: ShoppingToolDeps = { getUserBySubject, listItems, addItems, removeItem, clearItems };
const FAIL = 'Não consegui acessar a lista de compras agora. Tenta de novo em instantes.';

export function buildShoppingTools(
  identity: ChatIdentity,
  deps: ShoppingToolDeps = defaultDeps,
): ToolSet {
  return {
    shopping_list: tool({
      description: 'Mostra a lista de compras compartilhada do casal.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const items = await deps.listItems();
          if (items.length === 0) return 'A lista de compras está vazia.';
          return JSON.stringify(items);
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_add: tool({
      description: 'Adiciona um ou mais itens à lista de compras.',
      inputSchema: z.object({ items: z.array(z.string()).min(1) }),
      execute: async ({ items }) => {
        try {
          const by = identity.subject
            ? ((await deps.getUserBySubject(identity.subject))?.id ?? null)
            : null;
          await deps.addItems(items, by);
          return `${items.length} item(ns) adicionados à lista.`;
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_remove: tool({
      description: 'Remove um item da lista (use o id retornado por shopping_list).',
      inputSchema: z.object({ item_id: z.string() }),
      execute: async ({ item_id }) => {
        try {
          await deps.removeItem(item_id);
          return 'Item removido.';
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_clear: tool({
      description: 'Esvazia a lista de compras. Confirme com o usuário na conversa ANTES de chamar.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          await deps.clearItems();
          return 'Lista de compras esvaziada.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
