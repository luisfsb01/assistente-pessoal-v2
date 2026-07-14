import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import { aggregateMonth, lastDayOfMonth } from './month-summary.js';

const cats: Category[] = [
  { id: 'r1', name: 'Casa', parent_id: null, monthly_target: 1000, counts: true, type: 'expense' },
  { id: 's1', name: 'Energia', parent_id: 'r1', monthly_target: null, counts: true, type: 'expense' },
  { id: 'r2', name: 'Salário', parent_id: null, monthly_target: null, counts: true, type: 'income' },
  { id: 'r3', name: 'Investimentos', parent_id: null, monthly_target: null, counts: true, type: 'investment' },
  { id: 'r4', name: 'Transferências', parent_id: null, monthly_target: null, counts: false, type: 'expense' },
];

const tx = (over: Partial<Transaction & { category_name: string | null }>): Transaction & { category_name: string | null } => ({
  id: 't1',
  occurred_on: '2026-07-10',
  description: 'X',
  amount: 100,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'confirmed',
  review_code: null,
  category_name: null,
  ...over,
});

describe('lastDayOfMonth', () => {
  it('fevereiro e meses de 31', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2026-07')).toBe('2026-07-31');
  });
});

describe('aggregateMonth', () => {
  it('replica a agregação da tool (raiz, counts, investimento, sem categoria)', () => {
    const out = aggregateMonth('2026-07', [
      tx({ id: 'a', amount: 200, category_id: 's1' }),
      tx({ id: 'b', amount: 300, category_id: 'r1' }),
      tx({ id: 'c', amount: 5000, kind: 'income', category_id: 'r2' }),
      tx({ id: 'd', amount: 1000, category_id: 'r3' }),
      tx({ id: 'e', amount: 999, category_id: 'r4' }),
      tx({ id: 'f', amount: 50, category_id: null, status: 'pending_review' }),
    ], cats);
    expect(out.month).toBe('2026-07');
    expect(out.income).toBe(5000);
    expect(out.expense).toBe(550);
    expect(out.invested).toBe(1000);
    expect(out.balance).toBe(5000 - 550 - 1000);
    expect(out.pending_review).toBe(1);
    expect(out.by_category[0]).toEqual({ category: 'Casa', spent: 500, target: 1000 });
    expect(out.by_category.find((c) => c.category === 'Sem categoria')).toEqual({ category: 'Sem categoria', spent: 50, target: null });
  });
});
