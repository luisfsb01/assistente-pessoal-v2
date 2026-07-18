import { supabase } from './client.js';

export type UsageRow = {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
};

type StoredUsage = { purpose: string; cost_brl: number; created_at: string };
export type MonthlyCost = { month: string; costBrl: number };

export function monthKeysEndingAt(endMonth: string, count: number): string[] {
  const [year, month] = endMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  });
}

export function aggregateMonthlyCosts(
  rows: Array<Pick<StoredUsage, 'cost_brl' | 'created_at'>>,
  months: string[],
): MonthlyCost[] {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const row of rows) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date(row.created_at));
    const month = `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
    if (totals.has(month)) totals.set(month, (totals.get(month) ?? 0) + Number(row.cost_brl));
  }
  return months.map((month) => ({ month, costBrl: totals.get(month) ?? 0 }));
}

function currentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

async function listUsageSince(month: string): Promise<StoredUsage[]> {
  const { data, error } = await supabase
    .from('llm_usage')
    .select('purpose, cost_brl, created_at')
    .gte('created_at', `${month}-01T00:00:00-03:00`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as StoredUsage[];
}

export async function recordUsage(u: UsageRow): Promise<void> {
  const { error } = await supabase.from('llm_usage').insert({
    model: u.model,
    purpose: u.purpose,
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cost_brl: u.costBrl,
  });
  if (error) throw error;
}

export async function getMonthCostBrl(): Promise<number> {
  const month = currentMonthKey();
  const rows = await listUsageSince(month);
  return rows.reduce((total, row) => total + Number(row.cost_brl), 0);
}

export async function getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>> {
  const rows = await listUsageSince(currentMonthKey());
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.purpose, (totals.get(row.purpose) ?? 0) + Number(row.cost_brl));
  return [...totals]
    .map(([purpose, costBrl]) => ({ purpose, costBrl }))
    .sort((a, b) => b.costBrl - a.costBrl);
}

export async function getMonthlyCostHistory(count = 12): Promise<MonthlyCost[]> {
  const months = monthKeysEndingAt(currentMonthKey(), count);
  const rows = await listUsageSince(months[0]);
  return aggregateMonthlyCosts(rows, months);
}
