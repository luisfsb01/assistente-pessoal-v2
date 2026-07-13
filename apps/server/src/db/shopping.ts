import { supabase } from './client.js';

export type ShoppingItem = { id: string; name: string };

export async function listItems(): Promise<ShoppingItem[]> {
  const { data, error } = await supabase
    .from('shopping_items')
    .select('id, name')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShoppingItem[];
}

export async function addItems(names: string[], addedByUserId: string | null): Promise<void> {
  const rows = names.map((name) => ({ name, added_by: addedByUserId }));
  const { error } = await supabase.from('shopping_items').insert(rows);
  if (error) throw error;
}

export async function removeItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('shopping_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function clearItems(): Promise<void> {
  const { error } = await supabase.from('shopping_items').delete().gte('created_at', '1970-01-01');
  if (error) throw error;
}
