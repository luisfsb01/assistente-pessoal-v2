import { getTransactionById, learnRule, setTransactionCategory } from '../db/finance.js';

export type ReclassificationItem = { id: string; categoryId: string };

export type ReclassificationDeps = {
  getTransactionById: typeof getTransactionById;
  setTransactionCategory: typeof setTransactionCategory;
  learnRule: typeof learnRule;
};

const defaultDeps: ReclassificationDeps = {
  getTransactionById,
  setTransactionCategory,
  learnRule,
};

export class TransactionNotFoundError extends Error {
  constructor() {
    super('Transação não encontrada.');
    this.name = 'TransactionNotFoundError';
  }
}

/** Confirma a nova categoria e transforma a correção humana na regra prioritária. */
export async function reclassifyTransactions(
  items: ReclassificationItem[],
  deps: ReclassificationDeps = defaultDeps,
): Promise<{ updated: number; learned: number }> {
  let updated = 0;
  let learned = 0;
  for (const item of items) {
    const transaction = await deps.getTransactionById(item.id);
    if (!transaction) throw new TransactionNotFoundError();
    if (!(await deps.setTransactionCategory(transaction.id, item.categoryId))) {
      throw new TransactionNotFoundError();
    }
    updated++;
    await deps.learnRule(transaction.description, item.categoryId);
    learned++;
  }
  return { updated, learned };
}
