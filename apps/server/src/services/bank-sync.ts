import { applyRules, setTransactionCategory, upsertBankTransactions } from '../db/finance.js';
import { listBankTransactions } from '../lib/banco-mcp.js';

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
