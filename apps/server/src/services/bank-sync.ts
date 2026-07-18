import {
  applyRules,
  getLastImportedDate,
  getLatestBankTransactionDate,
  listCategories,
  listUncategorizedBankTransactions,
  setLastImportedDate,
  setTransactionCategory,
  suggestTransactionCategory,
  upsertBankTransactions,
  type Category,
} from '../db/finance.js';
import { isBankConfigured, listBankTransactions } from '../lib/banco-mcp.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { suggestCategoriesFor } from './categorize.js';

export type BankSyncDeps = {
  listBankTransactions: typeof listBankTransactions;
  upsertBankTransactions: typeof upsertBankTransactions;
  listUncategorizedBankTransactions: typeof listUncategorizedBankTransactions;
  listCategories: typeof listCategories;
  applyRules: typeof applyRules;
  setTransactionCategory: typeof setTransactionCategory;
  suggestTransactionCategory: typeof suggestTransactionCategory;
  suggestCategoriesFor: (
    txs: Array<{ id: string; description: string; amount: number }>,
    categories: Category[],
  ) => Promise<Map<string, Category>>;
};

const defaultDeps: BankSyncDeps = {
  listBankTransactions,
  upsertBankTransactions,
  listUncategorizedBankTransactions,
  listCategories,
  applyRules,
  setTransactionCategory,
  suggestTransactionCategory,
  suggestCategoriesFor: (txs, categories) => suggestCategoriesFor(txs, categories),
};

/** Importa transações do Banco MCP e classifica tudo que ainda estiver sem categoria.
 *  Regras aprendidas são confirmadas automaticamente; as demais recebem sugestão da IA
 *  e continuam pendentes para revisão humana. */
export async function syncBankTransactions(
  fromDate: string,
  toDate: string,
  deps: BankSyncDeps = defaultDeps,
): Promise<{ imported: number; autoClassified: number }> {
  const bankTxs = await deps.listBankTransactions(fromDate, toDate);
  const inserted = await deps.upsertBankTransactions(
    bankTxs
      .filter((t) => t.id)
      .map((t) => ({ externalId: t.id, occurredOn: t.date, description: t.description, amount: t.amount, kind: t.kind })),
  );
  // Inclui registros importados em tentativas anteriores: se a IA falhou, o próximo
  // clique em Atualizar retoma a categorização em vez de deixá-los órfãos.
  const uncategorized = await deps.listUncategorizedBankTransactions();
  const ruleMatches = await deps.applyRules(
    uncategorized.map((t) => ({ id: t.id, description: t.description })),
  );
  let autoClassified = 0;
  const classifiedIds = new Set<string>();
  for (const [txId, categoryId] of ruleMatches) {
    const ok = await deps.setTransactionCategory(txId, categoryId);
    if (ok) {
      autoClassified++;
      classifiedIds.add(txId);
    }
  }

  const remaining = uncategorized.filter((t) => !classifiedIds.has(t.id));
  if (remaining.length > 0) {
    try {
      const categories = await deps.listCategories();
      const suggestions = await deps.suggestCategoriesFor(
        remaining.map((t) => ({ id: t.id, description: t.description, amount: Number(t.amount) })),
        categories,
      );
      for (const tx of remaining) {
        const category = suggestions.get(tx.id);
        if (!category) continue;
        if (await deps.suggestTransactionCategory(tx.id, category.id)) autoClassified++;
      }
    } catch (err) {
      // Importação continua válida. Como a categoria permanece nula, o próximo
      // clique tenta novamente sem duplicar a transação bancária.
      console.error('[bank-sync] categorização automática falhou (será repetida):', err);
    }
  }
  return { imported: inserted.length, autoClassified };
}

export class BankNotConfiguredError extends Error {
  constructor() {
    super('Integração bancária não configurada.');
    this.name = 'BankNotConfiguredError';
  }
}

export type ManualBankSyncDeps = {
  isBankConfigured(): boolean;
  getLastImportedDate(): Promise<string | null>;
  getLatestBankTransactionDate(): Promise<string | null>;
  setLastImportedDate(date: string): Promise<void>;
  today(): string;
  sync(fromDate: string, toDate: string): Promise<{ imported: number; autoClassified: number }>;
};

const defaultManualDeps: ManualBankSyncDeps = {
  isBankConfigured,
  getLastImportedDate,
  getLatestBankTransactionDate,
  setLastImportedDate,
  today: () => todayInTz(getConfig().TIMEZONE),
  sync: (fromDate, toDate) => syncBankTransactions(fromDate, toDate),
};

/** Sincroniza manualmente da última data conhecida até hoje, incluindo a
 * data inicial para capturar lançamentos tardios. O upsert por external_id
 * mantém a operação idempotente. O cursor só avança depois do sucesso. */
export async function syncBankTransactionsToToday(
  deps: ManualBankSyncDeps = defaultManualDeps,
): Promise<{ from: string; to: string; imported: number; autoClassified: number }> {
  if (!deps.isBankConfigured()) throw new BankNotConfiguredError();

  const to = deps.today();
  const stored = await deps.getLastImportedDate();
  const latest = stored ?? await deps.getLatestBankTransactionDate();
  const from = latest && latest <= to ? latest : to;
  const result = await deps.sync(from, to);
  await deps.setLastImportedDate(to);
  return { from, to, ...result };
}
