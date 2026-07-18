import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { InboxEmail } from '../lib/gmail.js';
import { buildCleanupPrompt, isProtectedEmail, runEmailCleanup, type CleanupState, type EmailCleanupDeps } from './email-cleanup.js';

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
    listProtections: async () => [],
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

describe('isProtectedEmail', () => {
  it('protege por remetente, domínio, assunto ou termo geral sem diferenciar maiúsculas e acentos', () => {
    const target = email('m1', {
      from: 'Escola <avisos@colegio.com.br>',
      subject: 'Atualização da matrícula',
      snippet: 'Informação pedagógica',
    });
    expect(isProtectedEmail(target, [{ id: '1', matchOn: 'sender', matchValue: 'Escola', description: null }])).toBe(true);
    expect(isProtectedEmail(target, [{ id: '2', matchOn: 'domain', matchValue: 'colegio.com.br', description: null }])).toBe(true);
    expect(isProtectedEmail(target, [{ id: '3', matchOn: 'subject', matchValue: 'matricula', description: null }])).toBe(true);
    expect(isProtectedEmail(target, [{ id: '4', matchOn: 'any', matchValue: 'pedagogica', description: null }])).toBe(true);
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

  it('lixo vai para a lixeira com evento resolvido; importante e normal ficam na caixa; cursor avança', async () => {
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
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      kind: 'email_trashed',
      dedupeKey: 'gmail:trash:m1',
      resolution: { decision: 'ignore', status: 'ignored', target: 'luis' },
    });
    expect(inserted[0].summary).toContain('Assunto m1');
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 8_000 });
  });

  it('proteção aprendida impede a lixeira antes da classificação e avança o cursor', async () => {
    let generated = false;
    const { d, state, trashed } = deps({
      listNewInboxEmails: async () => [email('m1', { from: 'Escola <avisos@colegio.com.br>', internalDate: 9_000 })],
      listProtections: async () => [
        { id: 'p1', matchOn: 'domain', matchValue: 'colegio.com.br', description: 'E-mails da escola' },
      ],
      generate: async () => {
        generated = true;
        return { verdicts: [{ id: 'm1', verdict: 'lixo', reason: 'promoção' }] } as never;
      },
    });
    expect(await runEmailCleanup(d)).toEqual({ scanned: 1, trashed: 0, important: 0 });
    expect(generated).toBe(false);
    expect(trashed).toEqual([]);
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 9_000 });
  });

  it('falha ao carregar proteções aborta sem classificar, descartar ou avançar o cursor', async () => {
    let generated = false;
    const { d, state, trashed } = deps({
      listNewInboxEmails: async () => [email('m1', { internalDate: 9_000 })],
      listProtections: async () => {
        throw new Error('banco fora');
      },
      generate: async () => {
        generated = true;
        return { verdicts: [] } as never;
      },
    });
    expect(await runEmailCleanup(d)).toEqual({ scanned: 1, trashed: 0, important: 0 });
    expect(generated).toBe(false);
    expect(trashed).toEqual([]);
    expect(state.get('gmail_cleanup_state')).toEqual({ lastInternalDate: 1_000 });
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
