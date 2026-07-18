import { supabase } from './client.js';

export type ChatIdentity = {
  chatId: number;
  kind: 'private' | 'group';
  userName: string | null;
  subject: 'luis' | 'esposa' | null;
};

export async function getChatIdentity(chatId: number, senderId?: number): Promise<ChatIdentity | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id, kind, users ( name, subject )')
    .eq('id', chatId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (senderId !== undefined) {
    if (data.kind === 'private' && Number(data.id) !== senderId) return null;
    if (data.kind === 'group') {
      const { data: sender, error: senderError } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_chat_id', senderId)
        .maybeSingle();
      if (senderError) throw senderError;
      if (!sender) return null;
    }
  }
  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  return {
    chatId: Number(data.id),
    kind: data.kind as 'private' | 'group',
    userName: user?.name ?? null,
    subject: (user?.subject as 'luis' | 'esposa' | undefined) ?? null,
  };
}

export type UserRecord = { id: string; name: string; calendarId: string | null };

export async function getUserBySubject(subject: 'luis' | 'esposa'): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, calendar_id')
    .eq('subject', subject)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, calendarId: data.calendar_id ?? null };
}

/** chat_id do Telegram do privado de um usuário (para jobs que enviam mensagem direta). */
export async function getSubjectChatId(subject: 'luis' | 'esposa'): Promise<number | null> {
  const { data, error } = await supabase
    .from('users')
    .select('telegram_chat_id')
    .eq('subject', subject)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.telegram_chat_id) : null;
}

/** chat_id do grupo do casal (primeiro chat kind='group'); null se não cadastrado. */
export async function getGroupChatId(): Promise<number | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .eq('kind', 'group')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.id) : null;
}
