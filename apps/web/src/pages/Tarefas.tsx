import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { Modal } from '../components/Modal'

interface Task {
  id: string
  user_id: string
  title: string
  status: 'open' | 'done'
  due_date: string | null
  done_at: string | null
}

function formatDue(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function Tarefas() {
  const { users, error: usersError } = useUsers()
  const [items, setItems] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [personFilter, setPersonFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open')

  const [newTitle, setNewTitle] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [newDue, setNewDue] = useState('')
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUserId, setEditUserId] = useState('')
  const [editDue, setEditDue] = useState('')
  const [deleting, setDeleting] = useState<Task | null>(null)

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    let q = supabase.from('tasks').select('*')
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (personFilter !== 'all') q = q.eq('user_id', personFilter)
    const { data, error } = await q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setItems(data as Task[])
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter, personFilter])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('tasks').insert({
      user_id: newUserId,
      title: newTitle.trim(),
      due_date: newDue || null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewTitle(''); setNewDue('')
    await load()
  }

  async function toggleDone(t: Task) {
    setError(null)
    const done = t.status === 'open'
    const { error } = await supabase
      .from('tasks')
      .update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null })
      .eq('id', t.id)
    if (error) { setError(error.message); return }
    await load()
  }

  function openEdit(t: Task) {
    setEditing(t)
    setEditTitle(t.title)
    setEditUserId(t.user_id)
    setEditDue(t.due_date ?? '')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editTitle.trim()) return
    setError(null)
    const { error } = await supabase
      .from('tasks')
      .update({ title: editTitle.trim(), user_id: editUserId, due_date: editDue || null })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  async function handleDelete() {
    if (!deleting) return
    setError(null)
    const { error } = await supabase.from('tasks').delete().eq('id', deleting.id)
    if (error) { setError(error.message); return }
    setDeleting(null)
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Tarefas</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Nova tarefa</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Título</label>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required className="input" placeholder="ex.: Levar o carro na revisão" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Pessoa</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-40">
            <label className="text-xs font-medium text-muted">Prazo (opcional)</label>
            <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="input" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="input w-40">
          <option value="all">Todas as pessoas</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input w-40">
          <option value="open">Abertas</option>
          <option value="done">Concluídas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhuma tarefa aqui.</p>}

      <div className="flex flex-col gap-3">
        {items.map((t) => (
          <div key={t.id} className="card flex items-center gap-4 flex-wrap">
            <button
              onClick={() => toggleDone(t)}
              className="shrink-0 w-6 h-6 rounded-full border border-hairline grid place-items-center text-sm"
              title={t.status === 'open' ? 'Concluir' : 'Reabrir'}
            >
              {t.status === 'done' ? '✅' : ''}
            </button>
            <div className="flex-1 min-w-0">
              <span className={`text-sm font-medium ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>
                {t.title}
              </span>
              <span className="ml-2 text-xs text-muted">
                {userName(t.user_id)}{t.due_date ? ` · até ${formatDue(t.due_date)}` : ''}
              </span>
            </div>
            <button onClick={() => openEdit(t)} className="btn-ghost shrink-0">Editar</button>
            <button onClick={() => setDeleting(t)} className="btn-ghost shrink-0 text-red-600">Excluir</button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar tarefa" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required className="input" />
            <select value={editUserId} onChange={(e) => setEditUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Excluir tarefa"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleDelete} className="btn-primary">Excluir</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir "{deleting.title}"?</p>
        </Modal>
      )}
    </div>
  )
}
