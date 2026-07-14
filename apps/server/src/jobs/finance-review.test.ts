import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { formatReviewLine } from './finance-review.js';

describe('formatReviewLine', () => {
  it('mostra código, data curta BR, valor em R$ e categoria', () => {
    const line = formatReviewLine(
      { occurred_on: '2026-07-12', description: 'UBER TRIP', amount: 24.9 },
      'A001',
      'Transporte > App',
    );
    expect(line).toContain('[A001]');
    expect(line).toContain('12/07');
    expect(line).toContain('R$ 24,90');
    expect(line).toContain('Transporte > App');
    expect(line).not.toContain('2026-07-12');
  });
  it('sem código ainda funciona', () => {
    const line = formatReviewLine({ occurred_on: '2026-07-12', description: 'X', amount: 1 }, null, 'Sem categoria');
    expect(line).not.toContain('[');
  });
});
