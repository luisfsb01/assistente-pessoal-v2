import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'

interface Project {
  id: string
  user_id: string
  name: string
  status: string | null
  updated_at: string
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

export default function Projetos() {
  const { users, error: usersError } = useUsers()
  const [items, setItems] = useState<Project[]>([])
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [saving, setSaving] = useState(false)

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('projects')
      .select('id, user_id, name, status, updated_at')
      .eq('active', true)
      .order('updated_at', { ascending: false })
    if (error) { setError(error.message); setLoading(false); return }
    const projects = data as Project[]
    const ids = projects.map((p) => p.id)
    const counts: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: ts, error: te } = await supabase
        .from('project_tasks')
        .select('project_id, status')
        .in('project_id', ids)
        .neq('status', 'done')
      if (te) { setError(te.message); setLoading(false); return }
      for (const t of ts ?? []) counts[t.project_id] = (counts[t.project_id] ?? 0) + 1
    }
    setItems(projects)
    setOpenCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('projects')
      .insert({ user_id: newUserId, name: newName.trim() })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName('')
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Projetos</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Novo projeto</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Nome</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input" placeholder="ex.: Site" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Dono</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhum projeto ativo.</p>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <Link key={p.id} to={`/projetos/${p.id}`} className="card hover:bg-surface-2 transition-colors flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">{p.name}</p>
            {p.status && <p className="text-xs text-ink">{p.status}</p>}
            <p className="text-xs text-muted">
              {userName(p.user_id)} · {openCounts[p.id] ?? 0} tarefa(s) aberta(s) · movimento {daysAgo(p.updated_at)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
