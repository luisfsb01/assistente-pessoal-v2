import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { aggregateMonthlyCosts, monthKeysEndingAt } from './usage.js';

describe('histórico mensal de custo LLM', () => {
  it('gera os meses em ordem cronológica atravessando o ano', () => {
    expect(monthKeysEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('agrega custos e preenche meses sem uso com zero', () => {
    const months = ['2026-05', '2026-06', '2026-07'];
    expect(aggregateMonthlyCosts([
      { cost_brl: 1.25, created_at: '2026-05-10T10:00:00Z' },
      { cost_brl: 2.75, created_at: '2026-05-20T10:00:00Z' },
      { cost_brl: 3, created_at: '2026-07-01T10:00:00Z' },
    ], months)).toEqual([
      { month: '2026-05', costBrl: 4 },
      { month: '2026-06', costBrl: 0 },
      { month: '2026-07', costBrl: 3 },
    ]);
  });

  it('respeita a virada do mês no fuso de São Paulo', () => {
    expect(aggregateMonthlyCosts([
      { cost_brl: 2, created_at: '2026-07-01T01:00:00Z' },
    ], ['2026-06', '2026-07'])).toEqual([
      { month: '2026-06', costBrl: 2 },
      { month: '2026-07', costBrl: 0 },
    ]);
  });
});
