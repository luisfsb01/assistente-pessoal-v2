import {
  categoryExpenseAvg,
  listCommitments,
  listRecentBankExpenses,
} from '../db/finance.js';
import { insertEvent } from '../db/events.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';

const BIG_TICKET = 800; // acima disso é sempre atípico
const MULTIPLIER = 3; // vezes a média da categoria
const MIN_AMOUNT = 100; // piso para não alertar miudeza
const MIN_SAMPLES = 5; // amostras mínimas para a média valer
const STATS_WINDOW_DAYS = 90;

/** PURA: um gasto é atípico se for muito alto em absoluto, ou muito acima da média da categoria. */
export function isAtypicalExpense(amount: number, stats: { avg: number; count: number }): boolean {
  if (amount >= BIG_TICKET) return true;
  return stats.count >= MIN_SAMPLES && amount >= MULTIPLIER * stats.avg && amount >= MIN_AMOUNT;
}

export type FinanceCollectorDeps = {
  listRecentBankExpenses: typeof listRecentBankExpenses;
  categoryExpenseAvg: typeof categoryExpenseAvg;
  listCommitments: typeof listCommitments;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: FinanceCollectorDeps = {
  listRecentBankExpenses,
  categoryExpenseAvg,
  listCommitments,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

/** Coleta eventos financeiros: gasto atípico (ontem/hoje) e compromisso do dia.
 *  Retorna quantos eventos NOVOS entraram na fila (dedupe descarta repetidos). */
export async function collectFinanceEvents(deps: FinanceCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  let inserted = 0;

  // 1) gastos atípicos entre ontem e hoje
  const recent = await deps.listRecentBankExpenses(addDays(today, -1));
  const statsWindow = addDays(today, -STATS_WINDOW_DAYS);
  for (const t of recent) {
    const stats = t.category_id
      ? await deps.categoryExpenseAvg(t.category_id, statsWindow)
      : { avg: 0, count: 0 };
    if (!isAtypicalExpense(Number(t.amount), stats)) continue;
    const [, m, d] = t.occurred_on.split('-');
    const ev = await deps.insertEvent({
      source: 'finance',
      kind: 'atypical_expense',
      dedupeKey: `fin:atypical:${t.id}`,
      summary: `Gasto atípico: ${t.description} — ${formatBrl(Number(t.amount))} em ${d}/${m}`,
      payload: { txId: t.id, amount: t.amount },
    });
    if (ev) inserted++;
  }

  // 2) compromissos do dia
  const dayOfMonth = Number(today.slice(8, 10));
  for (const c of await deps.listCommitments()) {
    if (c.day_of_month !== dayOfMonth) continue;
    const ev = await deps.insertEvent({
      source: 'finance',
      kind: 'commitment_due',
      dedupeKey: `fin:commitment:${c.id}:${today}`,
      summary: `Compromisso de hoje: ${c.description}${c.amount ? ` — ${formatBrl(Number(c.amount))}` : ''} (todo dia ${c.day_of_month})`,
      payload: { commitmentId: c.id },
    });
    if (ev) inserted++;
  }

  return inserted;
}
