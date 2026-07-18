import {
  applyRules,
  getLastImportedDate,
  getLatestBankTransactionDate,
  setLastImportedDate,
  setTransactionCategory,
  upsertBankTransactions,
} from '../db/finance.js';
import { isBankConfigured, listBankTransactions } from '../lib/banco-mcp.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

export type BankSyncDeps = {
  listBankTransactions: typeof listBankTransactions;
  upsertBankTransactions: typeof upsertBankTransactions;
  applyRules: typeof applyRules;
  setTransactionCategory: typeof setTransactionCategory;
};

const defaultDeps: BankSyncDeps = { listBankTransactions, upsertBankTransactions, applyRules, setTransactionCategory };

/** Importa transações do Banco MCP no intervalo e grava no Supabase (dedupe por external_id).
 *  Para as NOVAS, aplica regras aprendidas: as que casam já entram classificadas/confirmadas.
 *  Retorna quantas novas entraram e quantas foram auto-classificadas por regra. */
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
  const ruleMatches = await deps.applyRules(inserted.map((t) => ({ id: t.id, description: t.description })));
  let autoClassified = 0;
  for (const [txId, categoryId] of ruleMatches) {
    const ok = await deps.setTransactionCategory(txId, categoryId);
    if (ok) autoClassified++;
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
