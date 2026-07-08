export type BudgetStatus = 'ok' | 'warn' | 'exceeded';

export function budgetStatus(monthCostBrl: number, budgetBrl: number): BudgetStatus {
  if (monthCostBrl >= budgetBrl) return 'exceeded';
  if (monthCostBrl >= budgetBrl * 0.8) return 'warn';
  return 'ok';
}
