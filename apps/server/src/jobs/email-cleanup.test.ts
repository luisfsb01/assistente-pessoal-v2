import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { InboxEmail } from '../lib/gmail.js';
import { buildCleanupPrompt, runEmailCleanup, type CleanupState, type EmailCleanupDeps } from './email-cleanup.js';

const email = (id: string, over: Partial<InboxEmail> = {}): InboxEmail => ({
  id,
  from: 'Loja X <promo@lojax.com>',
  subject: `Assunto ${id}`,
  snippet: 'trecho...',
  categories: ['CATEGORY_PROMOTIONS'],
  starred: false,
  internalDate: 5_000,
  ...over,
});

type Inserted = { kind: string; dedupeKey: string; summary: string; resolution?: { decision: string; status: string; target: string } };

function deps(over: Partial<EmailCleanupDeps> = {}) {
  const state = new Map<string, unknown>([['gmail_cleanup_state', { lastInternalDate: 1_000 } satisfies CleanupState]]);
  const trashed: string[] = [];
  const inserted: Inserted[] = [];
  const d: EmailCleanupDeps = {
    listNewInboxEmails: async () => [],
    trashMessage: async (id) => void trashed.push(id),
    getState: async (k) => (state.get(k) as never) ?? null,
    setState: async (k, v) => void state.set(k, v),
    insertEvent: async (e) => {
      inserted.push(e as never);
      return { id: 'ev1' } as never;
    },
    recall: async () => [],
    generate: async () => ({ verdicts: [] }) as never,
    now: () => new Date('2026-07-15T12:00:00Z'),
    ...over,
  };
  return { d, state, trashed, inserted };
}

describe('buildCleanupPrompt', () => {
  it('inclui memórias, categoria do Gmail, remetente e assunto', () => {
    const p = buildCleanupPrompt([email('m1')], [{ content: 'Nunca jogar fora e-mails da escola' }]);
    expect(p).toContain('escola');
    expect(p).toContain('CATEGORY_PROMOTIONS');
    expect(p).toContain('promo@lojax.com');
    expect(p).toContain('Assunto m1');
  });
});

describe('runEmailCleanup', () => {
  it('primeira execução: salva o cursor e não lista nem classifica', async () => {
    let listed = false;
    const { d, state } = deps({
      getState: async () => null,
      listNewInboxEmails: async () => {
        listed = true;
        return [];
      },
    });
    const out = await runEmailCleanup(d);
    expect(out).toEqual({ scanned: 0, trashed: 0, important: 0 });
    expect(listed).toBe(false);
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: new Date('2026-07-15T12:00:00Z').getTime() });
  });

  it('sem e-mail novo, não chama a IA', async () => {
    let called = false;
    const { d } = deps({
      generate: async () => {
        called = true;
        return { verdicts: [] } as never;
      },
    });
    expect(await runEmailCleanup(d)).toEqual({ scanned: 0, trashed: 0, important: 0 });
    expect(called).toBe(false);
  });

  it('lixo vai para a lixeira com evento resolvido; importante vira evento queued; normal nada; cursor avança', async () => {
    const { d, state, trashed, inserted } = deps({
      listNewInboxEmails: async () => [
        email('m1', { internalDate: 6_000 }),
        email('m2', { internalDate: 7_000 }),
        email('m3', { internalDate: 8_000 }),
      ],
      generate: async () =>
        ({
          verdicts: [
            { id: 'm1', verdict: 'lixo', reason: 'promoção' },
            { id: 'm2', verdict: 'importante', reason: 'cobrança com prazo' },
            { id: 'm3', verdict: 'normal', reason: 'nada demais' },
          ],
        }) as never,
    });
    const out = await runEmailCleanup(d);
    expect(out).toEqual({ scanned: 3, trashed: 1, important: 1 });
    expect(trashed).toEqual(['m1']);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      kind: 'email_trashed',
      dedupeKey: 'gmail:trash:m1',
      resolution: { decision: 'ignore', status: 'ignored', target: 'luis' },
    });
    expect(inserted[0].summary).toContain('Assunto m1');
    expect(inserted[1]).toMatchObject({
      kind: 'email_important',
      dedupeKey: 'gmail:important:m2',
      resolution: { decision: 'briefing', status: 'queued', target: 'luis' },
    });
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 8_000 });
  });

  it('estrela nunca vai para a lixeira, mesmo com veredito lixo', async () => {
    const { d, trashed } = deps({
      listNewInboxEmails: async () => [email('m1', { starred: true })],
      generate: async () => ({ verdicts: [{ id: 'm1', verdict: 'lixo', reason: 'x' }] }) as never,
    });
    expect(await runEmailCleanup(d)).toEqual({ scanned: 1, trashed: 0, important: 0 });
    expect(trashed).toEqual([]);
  });

  it('falha da IA aborta sem avançar o cursor e sem lixeira', async () => {
    const { d, state, trashed } = deps({
      listNewInboxEmails: async () => [email('m1', { internalDate: 9_000 })],
      generate: async () => {
        throw new Error('boom');
      },
    });
    expect(await runEmailCleanup(d)).toEqual({ scanned: 1, trashed: 0, important: 0 });
    expect(trashed).toEqual([]);
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 1_000 });
  });

  it('rajada com mais de 50 novos: processa só os 50 mais antigos e o cursor avança até o 50º, não o mais novo', async () => {
    const emails60 = Array.from({ length: 60 }, (_, i) => email(`m${i + 1}`, { internalDate: 1001 + i })); // 1001..1060, mais antigo primeiro
    const { d, state } = deps({
      listNewInboxEmails: async () => emails60,
      generate: async () =>
        ({
          verdicts: Array.from({ length: 60 }, (_, i) => ({ id: `m${i + 1}`, verdict: 'normal', reason: '' })),
        }) as never,
    });
    const out = await runEmailCleanup(d);
    expect(out).toEqual({ scanned: 50, trashed: 0, important: 0 });
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 1050 }); // 50º mais antigo, não o 60º (1060)
  });

  it('id que a IA não devolveu = normal; falha no trash de um não derruba o outro', async () => {
    const { d, inserted } = deps({
      listNewInboxEmails: async () => [
        email('m1', { internalDate: 6_000 }),
        email('m2', { internalDate: 7_000 }),
      ],
      generate: async () =>
        ({
          verdicts: [
            { id: 'm1', verdict: 'lixo', reason: 'x' },
            { id: 'm2', verdict: 'lixo', reason: 'y' },
          ],
        }) as never,
      trashMessage: async (id) => {
        if (id === 'm1') throw new Error('trash falhou');
      },
    });
    const out = await runEmailCleanup(d);
    expect(out.trashed).toBe(1); // só m2
    expect(inserted.map((i) => i.dedupeKey)).toEqual(['gmail:trash:m2']); // m1 sem evento (trash falhou)
  });
});
