import { supabase } from '../db/client.js';

/** Extrai o token de um header `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export type AuthDeps = {
  getUserId(token: string): Promise<string | null>;
  isMember(userId: string): Promise<boolean>;
};

const defaultDeps: AuthDeps = {
  getUserId: async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  },
  isMember: async (userId) => {
    const { data, error } = await supabase
      .from('app_members')
      .select('auth_user_id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    return !error && data != null;
  },
};

/** Valida o JWT e exige que a conta esteja explicitamente em app_members. */
export async function isValidAccessToken(token: string, deps: AuthDeps = defaultDeps): Promise<boolean> {
  const userId = await deps.getUserId(token);
  return userId !== null && deps.isMember(userId);
}
