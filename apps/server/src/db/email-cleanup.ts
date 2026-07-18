import { supabase } from './client.js';

export type EmailProtectionMatch = 'sender' | 'domain' | 'subject' | 'any';

export type EmailCleanupProtection = {
  id: string;
  matchOn: EmailProtectionMatch;
  matchValue: string;
  description: string | null;
};

const COLS = 'id, match_on, match_value, description';

function toProtection(row: Record<string, unknown>): EmailCleanupProtection {
  return {
    id: row.id as string,
    matchOn: row.match_on as EmailProtectionMatch,
    matchValue: row.match_value as string,
    description: (row.description as string | null) ?? null,
  };
}

export async function addEmailCleanupProtection(input: {
  userId: string;
  matchOn: EmailProtectionMatch;
  matchValue: string;
  description?: string;
}): Promise<EmailCleanupProtection> {
  const matchValue = input.matchValue.trim().toLocaleLowerCase('pt-BR');
  const { data, error } = await supabase
    .from('email_cleanup_protections')
    .upsert(
      {
        user_id: input.userId,
        match_on: input.matchOn,
        match_value: matchValue,
        description: input.description?.trim() || null,
        active: true,
      },
      { onConflict: 'user_id,match_on,match_value' },
    )
    .select(COLS)
    .single();
  if (error) throw error;
  return toProtection(data);
}

export async function listEmailCleanupProtections(userId: string): Promise<EmailCleanupProtection[]> {
  const { data, error } = await supabase
    .from('email_cleanup_protections')
    .select(COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toProtection(row));
}
