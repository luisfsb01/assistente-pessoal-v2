import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Tx, Category } from './finance-data'
import type { Range } from './period'
import { fetchAllPages } from './fetch-all-pages'

export function useFinance(range: Range): {
  txs: Tx[]
  categories: Category[]
  loading: boolean
  error: string | null
} {
  const [txs, setTxs] = useState<Tx[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchData() {
      const [txRes, catRes] = await Promise.all([
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from('transactions')
            .select('id, occurred_on, description, amount, kind, category_id, status, categories(name)')
            .gte('occurred_on', range.from)
            .lte('occurred_on', range.to)
            .order('occurred_on', { ascending: false })
            .order('id', { ascending: true }) // desempate: paginação estável
            .range(from, to),
        ),
        supabase.from('categories').select('id, name, parent_id, monthly_target, type, counts'),
      ])

      if (cancelled) return

      if (txRes.error) {
        setError(txRes.error)
        setLoading(false)
        return
      }
      if (catRes.error) {
        setError(catRes.error.message)
        setLoading(false)
        return
      }

      const mappedTxs: Tx[] = txRes.rows.map((row) => {
        const r = row as { id: string; occurred_on: string; description: string; amount: number; kind: string; category_id: string | null; status: string; categories: { name: string }[] | { name: string } | null }
        return {
          id: r.id,
          occurred_on: r.occurred_on,
          description: r.description,
          amount: Number(r.amount),
          kind: r.kind as 'expense' | 'income',
          category_id: r.category_id ?? null,
          status: r.status as 'pending_review' | 'confirmed',
          category_name: (Array.isArray(r.categories)
            ? (r.categories as { name: string }[])[0]?.name ?? null
            : (r.categories as { name: string } | null)?.name ?? null),
        }
      })

      const mappedCats: Category[] = (catRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        parent_id: row.parent_id ?? null,
        monthly_target: row.monthly_target ?? null,
        counts: row.counts ?? true,
        type: (row.type ?? 'expense') as 'income' | 'expense' | 'investment',
      }))

      setTxs(mappedTxs)
      setCategories(mappedCats)
      setLoading(false)
    }

    fetchData()
    return () => { cancelled = true }
  }, [range.from, range.to])

  return { txs, categories, loading, error }
}
