import { describe, expect, it } from 'vitest';
import type { Category } from '../db/finance.js';
import { suggestCategoriesFor, type CategorizeDeps } from './categorize.js';

const cats: Category[] = [
  { id: 'c1', name: 'Transporte', parent_id: null, monthly_target: null, counts: true, type: 'expense' },
  { id: 'c2', name: 'Casa', parent_id: null, monthly_target: 2000, counts: true, type: 'expense' },
  { id: 'c3', name: 'Energia', parent_id: 'c2', monthly_target: null, counts: true, type: 'expense' },
];

function deps(over: Partial<CategorizeDeps> = {}): CategorizeDeps {
  return {
    applyRules: async () => new Map(),
    generate: async () => ({ classifications: [] }) as never,
    ...over,
  };
}

describe('suggestCategoriesFor', () => {
  it('regra aprendida resolve sem chamar a IA', async () => {
    let aiCalled = false;
    const d = deps({
      applyRules: async () => new Map([['t1', 'c1']]),
      generate: async () => {
        aiCalled = true;
        return { classifications: [] } as never;
      },
    });
    const out = await suggestCategoriesFor([{ id: 't1', description: 'UBER', amount: 20 }], cats, d);
    expect(out.get('t1')?.id).toBe('c1');
    expect(aiCalled).toBe(false);
  });

  it('o que sobra vai para a IA; casa pelo ÚLTIMO segmento do caminho, case-insensitive', async () => {
    const d = deps({
      generate: async () =>
        ({ classifications: [{ id: 't2', category: 'casa > ENERGIA' }, { id: 't3', category: 'Inexistente' }] }) as never,
    });
    const out = await suggestCategoriesFor(
      [
        { id: 't2', description: 'CEMIG', amount: 150 },
        { id: 't3', description: 'XYZ', amount: 10 },
      ],
      cats,
      d,
    );
    expect(out.get('t2')?.id).toBe('c3');
    expect(out.has('t3')).toBe(false);
  });

  it('prompt oferece caminhos completos ("Casa > Energia")', async () => {
    let seenPrompt = '';
    const d = deps({
      generate: async (opts) => {
        seenPrompt = opts.prompt;
        return { classifications: [] } as never;
      },
    });
    await suggestCategoriesFor([{ id: 't1', description: 'CEMIG', amount: 150 }], cats, d);
    expect(seenPrompt).toContain('Casa > Energia');
  });
});
