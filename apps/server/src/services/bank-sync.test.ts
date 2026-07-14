import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/finance.js';
import { syncBankTransactions, type BankSyncDeps } from './bank-sync.js';

const tx = (id: string, description: string): Transaction => ({
  id,
  occurred_on: '2026-07-12',
  description,
  amount: 10,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
});

describe('syncBankTransactions', () => {
  it('importa, aplica regras nas novas e conta as auto-classificadas', async () => {
    const classified: string[] = [];
    const deps: BankSyncDeps = {
      listBankTransactions: async () => [
        { id: 'e1', date: '2026-07-12', description: 'UBER', amount: 10, kind: 'expense', providerCategory: null },
        { id: 'e2', date: '2026-07-12', description: 'XYZ', amount: 5, kind: 'expense', providerCategory: null },
      ],
      upsertBankTransactions: async (rows) => rows.map((r, i) => tx(`t${i + 1}`, r.description)),
      applyRules: async (items) => new Map(items.filter((i) => i.description === 'UBER').map((i) => [i.id, 'c1'])),
      setTransactionCategory: async (id, catId) => {
        classified.push(`${id}:${catId}`);
        return true;
      },
    };
    const r = await syncBankTransactions('2026-07-12', '2026-07-12', deps);
    expect(r).toEqual({ imported: 2, autoClassified: 1 });
    expect(classified).toEqual(['t1:c1']);
  });
});
