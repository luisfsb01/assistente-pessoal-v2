import { supabase } from '../db/client.js';

/** Extrai o token de um header `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Valida um access token do Supabase Auth (o JWT da sessão do web). */
export async function isValidAccessToken(token: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser(token);
  return !error && data.user != null;
}
