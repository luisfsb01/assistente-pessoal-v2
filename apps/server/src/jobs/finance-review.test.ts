import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { buildHermesFinanceButtons, formatReviewLine } from './finance-review.js';

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
  it('no Hermes orienta o botão e mantém a troca por texto', () => {
    const line = formatReviewLine(
      { occurred_on: '2026-07-12', description: 'UBER', amount: 20 },
      'A002',
      'Transporte',
      'hermes',
    );
    expect(line).toContain('use o botão Confirmar');
    expect(line).toContain('A002 é <categoria>');
  });

  it('monta um botão autossuficiente para cada transação no Hermes', () => {
    const kb = buildHermesFinanceButtons(['A001', 'A002']);
    expect(kb).toMatchObject({
      keyboard: [[{ text: '✅ Confirmar A001' }], [{ text: '✅ Confirmar A002' }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  });
});
