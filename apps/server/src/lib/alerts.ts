import type { BudgetStatus } from './budget.js';

type AlertDeps = {
  send: (text: string) => Promise<void>;
  getState: <T>(key: string) => Promise<T | null>;
  setState: (key: string, value: unknown) => Promise<void>;
};

export function createBudgetAlert(deps: AlertDeps) {
  return async (status: BudgetStatus, monthCostBrl: number): Promise<void> => {
    if (status === 'ok') return;
    const month = new Date().toISOString().slice(0, 7); // ex.: 2026-07
    const key = `budget_alert_${status}_${month}`;
    if (await deps.getState(key)) return;
    const cost = monthCostBrl.toFixed(2);
    const text =
      status === 'warn'
        ? `⚠️ Orçamento de IA: já usei R$ ${cost} este mês (≥80% do teto). Vou seguir normal, mas fica o aviso.`
        : `🛑 Orçamento de IA estourado (R$ ${cost}). Passei a usar só o modelo econômico até o fim do mês.`;
    await deps.send(text);
    await deps.setState(key, true);
  };
}
