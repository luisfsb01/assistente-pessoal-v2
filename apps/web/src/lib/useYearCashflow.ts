import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { MonthFlow } from './finance-data'

/**
 * Fluxo mensal do ano agregado NO BANCO (rpc monthly_cashflow, migração 0008).
 * Substitui o download do ano inteiro de transações no Dashboard.
 */
export function useYearCashflow(year: number): {
  flow: MonthFlow[]
  loading: boolean
  error: string | null
} {
  const [flow, setFlow] = useState<MonthFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase.rpc('monthly_cashflow', { p_year: year }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      const rows = (data ?? []) as Array<{ month: number; income: number; expense: number; invested: number }>
      setFlow(rows.map((r) => ({
        month: r.month - 1, // SQL devolve 1-12; MonthFlow usa 0-11
        income: Number(r.income),
        expense: Number(r.expense),
        invested: Number(r.invested),
      })))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [year])

  return { flow, loading, error }
}
