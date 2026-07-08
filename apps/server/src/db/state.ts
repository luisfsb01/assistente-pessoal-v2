import { supabase } from './client.js';

export async function getState<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return (data?.value as T) ?? null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from('app_state').upsert({ key, value });
  if (error) throw error;
}
