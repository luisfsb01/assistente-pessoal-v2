import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { Modal } from '../components/Modal'
import {
  formatTaskDate,
  taskDeadlineView,
  taskRecurrenceLabel,
  taskVisualStatus,
  type TaskRecurrenceUnit,
} from '../lib/task-display'
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'

interface Task {
  id: string
  user_id: string
  title: string
  status: 'open' | 'done'
  due_date: string | null
  initial_due_date?: string | null
  done_at: string | null
  created_at: string
  recurrence_unit?: TaskRecurrenceUnit | null
  recurrence_interval?: number | null
  recurrence_until?: string | null
}

const STATUS_STYLE = {
  open: { label: 'Em aberto', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300' },
  overdue: { label: 'Atrasada', className: 'bg-red-500/10 text-red-600 dark:text-red-300' },
  done: { label: 'Concluída', className: 'bg-brand-600/10 text-accent-soft-ink' },
} as const

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
  const [recurring, setRecurring] = useState(false)
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const [recurrenceConfigured, setRecurrenceConfigured] = useState(false)
  const [recurrenceUnit, setRecurrenceUnit] = useState<TaskRecurrenceUnit>('week')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [recurrenceError, setRecurrenceError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUserId, setEditUserId] = useState('')
  const [editDue, setEditDue] = useState('')
  const [deleting, setDeleting] = useState<Task | null>(null)
  const today = new Date().toLocaleDateString('en-CA')

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

  function resetRecurrence() {
    setRecurring(false)
    setRecurrenceOpen(false)
    setRecurrenceConfigured(false)
    setRecurrenceUnit('week')
    setRecurrenceInterval(1)
    setRecurrenceUntil('')
    setRecurrenceError(null)
  }

  function handleRecurringToggle(checked: boolean) {
    if (!checked) {
      resetRecurrence()
      return
    }
    setRecurring(true)
    setRecurrenceError(null)
    setRecurrenceOpen(true)
  }

  function closeRecurrenceModal() {
    setRecurrenceOpen(false)
    setRecurrenceError(null)
    if (!recurrenceConfigured) {
      setRecurring(false)
      setRecurrenceUnit('week')
      setRecurrenceInterval(1)
      setRecurrenceUntil('')
    }
  }

  function saveRecurrence(e: FormEvent) {
    e.preventDefault()
    const minimumEnd = newDue || today
    if (!recurrenceUntil) {
      setRecurrenceError('Informe até quando a tarefa deve se repetir.')
      return
    }
    if (recurrenceUntil < minimumEnd) {
      setRecurrenceError(
        newDue
          ? 'A data final não pode ser anterior ao prazo da tarefa.'
          : 'A data final não pode ser anterior a hoje.',
      )
      return
    }
    setRecurrenceConfigured(true)
    setRecurring(true)
    setRecurrenceError(null)
    setRecurrenceOpen(false)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newUserId) return
    if (recurring && !recurrenceConfigured) {
      setRecurrenceOpen(true)
      return
    }
    if (recurring && recurrenceUntil < (newDue || today)) {
      setRecurrenceError(
        newDue
          ? 'A data final não pode ser anterior ao prazo da tarefa.'
          : 'A data final não pode ser anterior a hoje.',
      )
      setRecurrenceOpen(true)
      return
    }
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('tasks').insert({
      user_id: newUserId,
      title: newTitle.trim(),
      due_date: newDue || null,
      recurrence_unit: recurring ? recurrenceUnit : null,
      recurrence_interval: recurring ? recurrenceInterval : null,
      recurrence_until: recurring ? recurrenceUntil : null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewTitle(''); setNewDue(''); resetRecurrence()
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
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => handleRecurringToggle(e.target.checked)}
              className="h-4 w-4 rounded border-hairline accent-[var(--color-brand-600)]"
            />
            Tarefa recorrente
          </label>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
        {recurring && recurrenceConfigured && (
          <button
            type="button"
            onClick={() => setRecurrenceOpen(true)}
            className="flex w-fit items-center gap-2 rounded-lg bg-brand-600/10 px-3 py-2 text-left text-xs font-semibold text-accent-soft-ink transition-colors hover:bg-brand-600/15"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {taskRecurrenceLabel(recurrenceUnit, recurrenceInterval, recurrenceUntil)}
            <span className="font-normal text-muted">Editar</span>
          </button>
        )}
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

      {!loading && items.length > 0 && <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-surface-2 border-b border-hairline">
              <tr className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted">
                <th className="w-14 px-5 py-3.5"><span className="sr-only">Finalizar</span></th>
                <th className="px-3 py-3.5">Tarefa</th>
                <th className="w-36 px-3 py-3.5">Data de criação</th>
                <th className="w-36 px-3 py-3.5">Prazo inicial</th>
                <th className="w-40 px-3 py-3.5">Prazo atualizado</th>
                <th className="w-32 px-3 py-3.5">Status</th>
                <th className="w-24 px-5 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((t) => {
                const visualStatus = taskVisualStatus(t, today)
                const status = STATUS_STYLE[visualStatus]
                const deadline = taskDeadlineView(t)
                return (
                  <tr key={t.id} className="group hover:bg-surface-2/60 transition-colors">
                    <td className="px-5 py-4 align-middle">
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        onChange={() => toggleDone(t)}
                        aria-label={t.status === 'open' ? `Concluir ${t.title}` : `Reabrir ${t.title}`}
                        className="h-4 w-4 cursor-pointer rounded border-hairline accent-[var(--color-brand-600)]"
                      />
                    </td>
                    <td className="px-3 py-4 align-middle">
                      <p className={`text-sm font-semibold ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>
                        {t.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{userName(t.user_id)}</p>
                      {t.recurrence_unit && t.recurrence_interval && t.recurrence_until && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-accent-soft-ink">
                          <RefreshCw size={12} aria-hidden="true" />
                          {taskRecurrenceLabel(
                            t.recurrence_unit,
                            t.recurrence_interval,
                            t.recurrence_until,
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-4 text-sm tabular-nums text-muted align-middle">
                      {formatTaskDate(t.created_at)}
                    </td>
                    <td className="px-3 py-4 text-sm tabular-nums text-muted align-middle">
                      {formatTaskDate(deadline.initial)}
                    </td>
                    <td className="px-3 py-4 text-sm tabular-nums align-middle">
                      {deadline.changed ? (
                        <span className="font-medium text-ink">
                          {deadline.current ? formatTaskDate(deadline.current) : 'Sem prazo'}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4 align-middle">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          aria-label={`Editar ${t.title}`}
                          title="Editar tarefa"
                          className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(t)}
                          aria-label={`Excluir ${t.title}`}
                          title="Excluir tarefa"
                          className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>}

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

      {recurrenceOpen && (
        <Modal title="Recorrência da tarefa" onClose={closeRecurrenceModal}>
          <form onSubmit={saveRecurrence} className="grid gap-4">
            <p className="text-sm leading-relaxed text-muted">
              A próxima tarefa será criada somente quando você concluir a atual.
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted">Repetir a cada</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value) || 1))}
                  required
                  className="input"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted">Frequência</label>
                <select
                  value={recurrenceUnit}
                  onChange={(e) => setRecurrenceUnit(e.target.value as TaskRecurrenceUnit)}
                  className="input"
                >
                  <option value="day">Dia(s)</option>
                  <option value="week">Semana(s)</option>
                  <option value="month">Mês(es)</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Até quando</label>
              <input
                type="date"
                min={newDue || today}
                value={recurrenceUntil}
                onChange={(e) => {
                  setRecurrenceUntil(e.target.value)
                  setRecurrenceError(null)
                }}
                required
                className="input"
              />
            </div>
            {recurrenceError && <p className="text-sm text-red-600">{recurrenceError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeRecurrenceModal} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar recorrência</button>
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
