import { describe, expect, it } from 'vitest';
import { gmailApiFromGoogle, mapMessage, mapSearchMessage } from './gmail.js';

const msg = (id: string, internalDate: number, labels: string[] = ['INBOX']) => ({
  id,
  internalDate: String(internalDate),
  labelIds: labels,
  snippet: 'a'.repeat(300),
  payload: {
    headers: [
      { name: 'From', value: 'Loja X <promo@lojax.com>' },
      { name: 'Subject', value: 'OFERTA imperdível' },
    ],
  },
});

describe('mapMessage', () => {
  it('extrai from/subject, categorias, estrela e trunca o snippet', () => {
    const m = mapMessage(msg('m1', 1000, ['INBOX', 'STARRED', 'CATEGORY_PROMOTIONS']) as never);
    expect(m).toEqual({
      id: 'm1',
      from: 'Loja X <promo@lojax.com>',
      subject: 'OFERTA imperdível',
      snippet: 'a'.repeat(200),
      categories: ['CATEGORY_PROMOTIONS'],
      starred: true,
      internalDate: 1000,
    });
  });
  it('mensagem sem headers/labels não explode', () => {
    const m = mapMessage({ id: 'm2' } as never);
    expect(m).toEqual({ id: 'm2', from: '', subject: '', snippet: '', categories: [], starred: false, internalDate: 0 });
  });
});

describe('mapSearchMessage', () => {
  it('decodifica o corpo base64url e prefere texto puro', () => {
    const body = Buffer.from('Produto: Fone Bluetooth').toString('base64url');
    const mapped = mapSearchMessage({
      ...msg('m3', 3000),
      payload: {
        headers: msg('m3', 3000).payload.headers,
        parts: [{ mimeType: 'text/plain', body: { data: body } }],
      },
    } as never);
    expect(mapped.bodyText).toBe('Produto: Fone Bluetooth');
  });

  it('converte HTML em texto quando não há parte text/plain', () => {
    const body = Buffer.from('<p>Produto: <b>Teclado Mecânico</b></p>').toString('base64url');
    const mapped = mapSearchMessage({
      ...msg('m4', 4000),
      payload: {
        headers: msg('m4', 4000).payload.headers,
        body: { data: body },
        mimeType: 'text/html',
      },
    } as never);
    expect(mapped.bodyText).toBe('Produto: Teclado Mecânico');
  });
});

describe('gmailApiFromGoogle', () => {
  it('lista só o que é estritamente mais novo que o cursor e monta a query certa', async () => {
    let seenQ = '';
    const client = {
      users: {
        messages: {
          list: async (args: { q: string }) => {
            seenQ = args.q;
            return { data: { messages: [{ id: 'velho' }, { id: 'novo' }] } };
          },
          get: async ({ id }: { id: string }) => ({ data: msg(id, id === 'novo' ? 5000 : 1000) }),
        },
      },
    } as never;
    const api = gmailApiFromGoogle(client);
    const out = await api.listNewInboxEmails(2_000);
    expect(seenQ).toBe('in:inbox after:2'); // epoch em segundos
    expect(out.map((e) => e.id)).toEqual(['novo']);
  });

  it('pagina até esgotar o nextPageToken e devolve tudo ordenado do mais antigo pro mais novo', async () => {
    const seenPageTokens: (string | undefined)[] = [];
    const client = {
      users: {
        messages: {
          list: async (args: { pageToken?: string }) => {
            seenPageTokens.push(args.pageToken);
            if (args.pageToken === undefined) {
              return { data: { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' } };
            }
            return { data: { messages: [{ id: 'c' }] } };
          },
          get: async ({ id }: { id: string }) => {
            const dates: Record<string, number> = { a: 3000, b: 5000, c: 1000 };
            return { data: msg(id, dates[id]) };
          },
        },
      },
    } as never;
    const api = gmailApiFromGoogle(client);
    const out = await api.listNewInboxEmails(500);
    expect(seenPageTokens).toEqual([undefined, 'p2']);
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'b']); // ascendente por internalDate
  });

  it('trashMessage chama a API com o id', async () => {
    const trashed: string[] = [];
    const client = {
      users: { messages: { trash: async ({ id }: { id: string }) => void trashed.push(id) } },
    } as never;
    await gmailApiFromGoogle(client).trashMessage('m9');
    expect(trashed).toEqual(['m9']);
  });

  it('pesquisa e busca o conteúdo completo dos e-mails', async () => {
    const calls: Array<{ query?: string; format?: string }> = [];
    const client = {
      users: {
        messages: {
          list: async ({ q }: { q: string }) => {
            calls.push({ query: q });
            return { data: { messages: [{ id: 'compra-1' }] } };
          },
          get: async ({ id, format }: { id: string; format: string }) => {
            calls.push({ format });
            return {
              data: {
                ...msg(id, 5000),
                payload: {
                  headers: msg(id, 5000).payload.headers,
                  body: { data: Buffer.from('Produto: Cafeteira').toString('base64url') },
                  mimeType: 'text/plain',
                },
              },
            };
          },
        },
      },
    } as never;
    const out = await gmailApiFromGoogle(client).searchEmails('after:1 before:2 Shopee', 5);
    expect(calls).toEqual([{ query: 'after:1 before:2 Shopee' }, { format: 'full' }]);
    expect(out[0]?.bodyText).toBe('Produto: Cafeteira');
  });
});
