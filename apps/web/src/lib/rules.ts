import { supabase } from './supabase'

/** Normaliza a descrição para servir de chave de regra: minúsculas, sem dígitos/pontuação, espaços colapsados.
 *  Mantém a MESMA implementação do servidor (apps/server/src/db/finance.ts). */
export function normalizePattern(desc: string): string {
  return desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[0-9]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Aprende que uma descrição mapeia para uma categoria.
 *  Se já existir regra para o mesmo pattern apontando para OUTRA categoria, a descrição é
 *  ambígua (mesma descrição, categorias diferentes) → remove a regra para que futuras
 *  descrições idênticas caiam na IA/manual em vez de uma regra errada. */
export async function upsertRule(description: string, categoryId: string): Promise<void> {
  const pattern = normalizePattern(description)
  if (!pattern) return
  const { data: existing } = await supabase
    .from('category_rules')
    .select('id, category_id')
    .eq('pattern', pattern)
    .maybeSingle()
  if (existing) {
    if (existing.category_id === categoryId) {
      await supabase.from('category_rules').update({ updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      // descrição ambígua (mesma descrição, categorias diferentes) → remove a regra
      await supabase.from('category_rules').delete().eq('id', existing.id)
    }
    return
  }
  await supabase
    .from('category_rules')
    .insert({ pattern, category_id: categoryId, updated_at: new Date().toISOString() })
}
