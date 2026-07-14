import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { QueueEvent } from '../db/events.js';
import { judgeEvents, type JudgeDeps } from './judge.js';

const ev = (id: string, summary: string): QueueEvent => ({
  id,
  source: 'finance',
  kind: 'atypical_expense',
  dedupeKey: `k-${id}`,
  summary,
  decision: null,
  reason: null,
  target: null,
  status: 'pending',
  createdAt: '2026-07-14T12:00:00Z',
});

function deps(over: Partial<JudgeDeps> = {}): JudgeDeps {
  return {
    recall: async () => [],
    generate: async () => ({ decisions: [] }) as never,
    ...over,
  };
}

describe('judgeEvents', () => {
  it('sem eventos, não chama a IA', async () => {
    let called = false;
    const d = deps({
      generate: async () => {
        called = true;
        return { decisions: [] } as never;
      },
    });
    expect(await judgeEvents([], '12:00', d)).toEqual([]);
    expect(called).toBe(false);
  });

  it('mapeia as decisões da IA e inclui memórias e hora no prompt', async () => {
    let seenPrompt = '';
    const d = deps({
      recall: async () => [{ content: 'Luis odeia ser interrompido com coisas triviais' }],
      generate: async (opts) => {
        seenPrompt = opts.prompt;
        return { decisions: [{ id: 'e1', decision: 'notify', target: 'luis', reason: 'gasto alto e incomum' }] } as never;
      },
    });
    const out = await judgeEvents([ev('e1', 'Gasto atípico: MERCADO LIVRE — R$ 950,00')], '14:30', d);
    expect(out).toEqual([{ id: 'e1', decision: 'notify', target: 'luis', reason: 'gasto alto e incomum' }]);
    expect(seenPrompt).toContain('R$ 950,00');
    expect(seenPrompt).toContain('14:30');
    expect(seenPrompt).toContain('coisas triviais');
  });

  it('evento que a IA não devolveu (ou com id desconhecido) vira briefing/luis por segurança', async () => {
    const d = deps({
      generate: async () =>
        ({ decisions: [{ id: 'zz-desconhecido', decision: 'ignore', target: 'luis', reason: 'x' }] }) as never,
    });
    const out = await judgeEvents([ev('e1', 'algo')], '10:00', d);
    expect(out).toEqual([
      { id: 'e1', decision: 'briefing', target: 'luis', reason: 'sem decisão da IA — guardado para o briefing' },
    ]);
  });

  it('falha da IA degrada tudo para briefing (nunca perde evento nem notifica sem julgamento)', async () => {
    const d = deps({
      generate: async () => {
        throw new Error('boom');
      },
    });
    const out = await judgeEvents([ev('e1', 'algo')], '10:00', d);
    expect(out[0].decision).toBe('briefing');
  });
});
