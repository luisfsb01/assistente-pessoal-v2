import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/finance.js';
import { collectFinanceEvents, isAtypicalExpense, type FinanceCollectorDeps } from './collect-finance.js';

describe('isAtypicalExpense', () => {
  it('grande valor absoluto é sempre atípico', () => {
    expect(isAtypicalExpense(800, { avg: 0, count: 0 })).toBe(true);
  });
  it('3x a média com amostra suficiente e piso de R$ 100', () => {
    expect(isAtypicalExpense(300, { avg: 90, count: 6 })).toBe(true);
    expect(isAtypicalExpense(250, { avg: 90, count: 6 })).toBe(false); // < 3x
    expect(isAtypicalExpense(90, { avg: 20, count: 6 })).toBe(false); // < piso 100
    expect(isAtypicalExpense(300, { avg: 90, count: 3 })).toBe(false); // amostra insuficiente
  });
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't1',
  occurred_on: '2026-07-14',
  description: 'X',
  amount: 100,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
  ...over,
});

function deps(over: Partial<FinanceCollectorDeps> = {}): FinanceCollectorDeps {
  return {
    listRecentBankExpenses: async () => [],
    categoryExpenseAvg: async () => ({ avg: 0, count: 0 }),
    listCommitments: async () => [],
    insertEvent: async () => null,
    todayIso: () => '2026-07-14',
    ...over,
  };
}

describe('collectFinanceEvents', () => {
  it('emite gasto atípico com dedupe por transação e valor em R$', async () => {
    const inserted: Array<{ dedupeKey: string; summary: string; kind: string }> = [];
    const d = deps({
      listRecentBankExpenses: async () => [tx({ id: 'aaa', description: 'MERCADO LIVRE', amount: 950 })],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e1' } as never;
      },
    });
    const n = await collectFinanceEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].kind).toBe('atypical_expense');
    expect(inserted[0].dedupeKey).toBe('fin:atypical:aaa');
    expect(inserted[0].summary).toContain('R$ 950,00');
  });

  it('gasto normal não vira evento; dedupe repetido não conta', async () => {
    const d = deps({
      listRecentBankExpenses: async () => [tx({ id: 'aaa', amount: 30 }), tx({ id: 'bbb', amount: 900 })],
      insertEvent: async () => null, // já existia
    });
    expect(await collectFinanceEvents(d)).toBe(0);
  });

  it('compromisso do dia vira evento com dedupe por dia', async () => {
    const inserted: Array<{ dedupeKey: string; summary: string }> = [];
    const d = deps({
      listCommitments: async () => [
        { id: 'c1', description: 'Internet', amount: 120, day_of_month: 14, active: true },
        { id: 'c2', description: 'Aluguel', amount: null, day_of_month: 5, active: true },
      ],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e1' } as never;
      },
    });
    const n = await collectFinanceEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].dedupeKey).toBe('fin:commitment:c1:2026-07-14');
    expect(inserted[0].summary).toContain('Internet');
  });
});
