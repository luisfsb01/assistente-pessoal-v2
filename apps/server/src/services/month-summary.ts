import {
  listCategories,
  listTransactionsBetween,
  type Category,
  type Transaction,
} from '../db/finance.js';
import { rootCategoryOf } from '../lib/category-tree.js';

export type MonthSummary = {
  month: string;
  income: number;
  expense: number;
  invested: number;
  balance: number;
  pending_review: number;
  by_category: Array<{ category: string; spent: number; target: number | null }>;
};

/** Último dia do mês YYYY-MM em YYYY-MM-DD. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Agregação pura do mês — mesma regra da tool finance_month_summary:
 *  pendências contadas antes da exclusão por counts; counts=false fora de todos
 *  os totais; raiz investment vira "invested"; sem categoria conta como despesa. */
export function aggregateMonth(
  month: string,
  txs: Array<Transaction & { category_name: string | null }>,
  cats: Category[],
): MonthSummary {
  let income = 0;
  let expense = 0;
  let invested = 0;
  let pendingReview = 0;
  const spentByRoot = new Map<string, number>();
  for (const t of txs) {
    if (t.status === 'pending_review') pendingReview++;
    const root = t.category_id ? rootCategoryOf(t.category_id, cats) : null;
    if (root && root.counts === false) continue; // transferências etc. não contam
    const amount = Number(t.amount);
    if (root?.type === 'investment') {
      invested += amount;
      continue;
    }
    if (t.kind === 'income') {
      income += amount;
    } else {
      expense += amount;
      const key = root?.name ?? 'Sem categoria';
      spentByRoot.set(key, (spentByRoot.get(key) ?? 0) + amount);
    }
  }
  const targetByName = new Map(
    cats.filter((c) => !c.parent_id && c.monthly_target != null).map((c) => [c.name, Number(c.monthly_target)]),
  );
  const byCategory = [...spentByRoot.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, spent]) => ({ category, spent, target: targetByName.get(category) ?? null }));
  return {
    month,
    income,
    expense,
    invested,
    balance: income - expense - invested,
    pending_review: pendingReview,
    by_category: byCategory,
  };
}

export type MonthSummaryDeps = {
  listCategories: typeof listCategories;
  listTransactionsBetween: typeof listTransactionsBetween;
};

const defaultDeps: MonthSummaryDeps = { listCategories, listTransactionsBetween };

export async function computeMonthSummary(month: string, deps: MonthSummaryDeps = defaultDeps): Promise<MonthSummary> {
  const [txs, cats] = await Promise.all([
    deps.listTransactionsBetween(`${month}-01`, lastDayOfMonth(month)),
    deps.listCategories(),
  ]);
  return aggregateMonth(month, txs, cats);
}
