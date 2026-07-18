import { apiFetch } from './api'

export type ReclassificationItem = { id: string; categoryId: string }

/** Reclassifica no servidor para que a correção e a regra aprendida usem a mesma fonte de verdade. */
export async function reclassifyTransactions(items: ReclassificationItem[]): Promise<void> {
  const response = await apiFetch('/api/finance/reclassify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    throw new Error(body.error || 'Não foi possível salvar o aprendizado da categorização.')
  }
}
