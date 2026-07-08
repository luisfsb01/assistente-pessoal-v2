import { describe, expect, it } from 'vitest';
import { estimateCostBrl } from './pricing.js';

describe('estimateCostBrl', () => {
  it('calcula custo do gpt-5-mini em BRL', () => {
    // 1M in ($0.25) + 1M out ($2.00) = $2.25 * 5.5 = R$ 12,375
    expect(estimateCostBrl('gpt-5-mini', 1_000_000, 1_000_000, 5.5)).toBeCloseTo(12.375);
  });

  it('embedding tem custo só de input', () => {
    expect(estimateCostBrl('text-embedding-3-small', 1_000_000, 0, 5.0)).toBeCloseTo(0.1);
  });

  it('modelo desconhecido usa preço conservador (não zero)', () => {
    expect(estimateCostBrl('modelo-novo', 1_000_000, 0, 5.0)).toBeGreaterThan(0);
  });
});
