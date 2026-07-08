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
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('llm_usage')
    .select('cost_brl')
    .gte('created_at', start.toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_brl), 0);
}
