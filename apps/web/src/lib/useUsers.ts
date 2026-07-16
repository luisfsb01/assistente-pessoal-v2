import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AppUser {
  id: string
  name: string
  subject: 'luis' | 'esposa'
}

export function useUsers(): { users: AppUser[]; error: string | null } {
  const [users, setUsers] = useState<AppUser[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, subject')
      .order('subject')
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        setUsers((data ?? []) as AppUser[])
      })
  }, [])

  return { users, error }
}
