import { supabase } from './client.js';

/** Claim atômico persistido no Supabase; false significa que o slot já rodou. */
export async function claimScheduledRun(key: string, slot: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_scheduled_run', {
    p_key: key,
    p_slot: slot,
  });
  if (error) throw error;
  return data === true;
}
