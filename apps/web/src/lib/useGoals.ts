import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Goal {
  id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
}

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('goals')
      .select('id, name, target_amount, current_amount, deadline')
      .order('created_at')
    if (error) setError(error.message)
    else
      setGoals(
        (data ?? []).map((g) => ({
          ...g,
          target_amount: Number(g.target_amount),
          current_amount: Number(g.current_amount),
        })) as Goal[],
      )
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  return { goals, loading, error, reload }
}

export async function createGoal(g: { name: string; target_amount: number; current_amount: number; deadline: string | null }) {
  const { error } = await supabase.from('goals').insert(g)
  if (error) throw new Error(error.message)
}
export async function updateGoal(id: string, g: { name: string; target_amount: number; current_amount: number; deadline: string | null }) {
  const { error } = await supabase.from('goals').update(g).eq('id', id)
  if (error) throw new Error(error.message)
}
export async function deleteGoal(id: string) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
