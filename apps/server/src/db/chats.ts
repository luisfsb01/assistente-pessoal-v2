import { supabase } from './client.js';

export type ChatIdentity = {
  chatId: number;
  kind: 'private' | 'group';
  userName: string | null;
  subject: 'luis' | 'esposa' | null;
};

export async function getChatIdentity(chatId: number): Promise<ChatIdentity | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id, kind, users ( name, subject )')
    .eq('id', chatId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  return {
    chatId: Number(data.id),
    kind: data.kind as 'private' | 'group',
    userName: user?.name ?? null,
    subject: (user?.subject as 'luis' | 'esposa' | undefined) ?? null,
  };
}
