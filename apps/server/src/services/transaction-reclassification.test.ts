import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/finance.js';
import {
  reclassifyTransactions,
  TransactionNotFoundError,
  type ReclassificationDeps,
} from './transaction-reclassification.js';

const transaction = (id: string, description: string): Transaction => ({
  id,
  occurred_on: '2026-07-18',
  description,
  amount: 10,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
});

describe('reclassifyTransactions', () => {
  it('confirma a categoria e aprende com a descrição de cada transação', async () => {
    const calls: string[] = [];
    const rows = new Map([
      ['t1', transaction('t1', 'UBER TRIP 123')],
      ['t2', transaction('t2', 'POSTO ABC 456')],
    ]);
    const deps: ReclassificationDeps = {
      getTransactionById: async (id) => rows.get(id) ?? null,
      setTransactionCategory: async (id, categoryId) => {
        calls.push(`set:${id}:${categoryId}`);
        return true;
      },
      learnRule: async (description, categoryId) => void calls.push(`learn:${description}:${categoryId}`),
    };
    expect(
      await reclassifyTransactions(
        [
          { id: 't1', categoryId: 'c1' },
          { id: 't2', categoryId: 'c2' },
        ],
        deps,
      ),
    ).toEqual({ updated: 2, learned: 2 });
    expect(calls).toEqual([
      'set:t1:c1',
      'learn:UBER TRIP 123:c1',
      'set:t2:c2',
      'learn:POSTO ABC 456:c2',
    ]);
  });

  it('recusa id inexistente sem inventar regra', async () => {
    let learned = false;
    await expect(
      reclassifyTransactions([{ id: 'missing', categoryId: 'c1' }], {
        getTransactionById: async () => null,
        setTransactionCategory: async () => true,
        learnRule: async () => void (learned = true),
      }),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
    expect(learned).toBe(false);
  });
});
