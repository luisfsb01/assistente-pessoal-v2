import { supabase } from './client.js';

export type UsageRow = {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
};

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
  const { data, error } = await supabase.rpc('sum_month_cost_brl');
  if (error) throw error;
  return Number(data ?? 0);
}

export async function getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>> {
  const { data, error } = await supabase.rpc('month_cost_by_purpose');
  if (error) throw error;
  return (data ?? []).map((r: { purpose: string; cost_brl: number }) => ({
    purpose: r.purpose,
    costBrl: Number(r.cost_brl),
  }));
}
