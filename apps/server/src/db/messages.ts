import { supabase } from './client.js';

export type ChatRole = 'user' | 'assistant';

export async function saveMessage(m: {
  chatId: number;
  role: ChatRole;
  content: string;
}): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .insert({ chat_id: m.chatId, role: m.role, content: m.content });
  if (error) throw error;
}

export async function getRecentMessages(
  chatId: number,
  limit = 20,
): Promise<{ role: ChatRole; content: string }[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse().map((r) => ({ role: r.role as ChatRole, content: r.content }));
}

export async function getMessagesSince(
  sinceIso: string,
): Promise<{ chatId: number; role: ChatRole; content: string; createdAt: string }[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('chat_id, role, content, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    chatId: Number(r.chat_id),
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}
