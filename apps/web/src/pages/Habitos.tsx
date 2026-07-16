import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { Modal } from '../components/Modal'
import { gridWeeks, todayIso } from '../lib/habit-weeks'

interface Habit {
  id: string
  user_id: string
  name: string
  target_per_week: number
  active: boolean
}

interface Checkin {
  habit_id: string
  date: string
  done: boolean
}

const WEEKS_SHOWN = 5
const DAY_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

export default function Habitos() {
  const { users, error: usersError } = useUsers()
  const [habits, setHabits] = useState<Habit[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('3')
  const [newUserId, setNewUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [editName, setEditName] = useState('')
  const [editTarget, setEditTarget] = useState('3')

  const today = todayIso()
  const weeks = gridWeeks(today, WEEKS_SHOWN)
  const firstDay = weeks[0][0]
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    const { data: hs, error: he } = await supabase
      .from('habits')
      .select('id, user_id, name, target_per_week, active')
      .eq('active', true)
      .order('created_at')
    if (he) { setError(he.message); setLoading(false); return }
    const ids = (hs ?? []).map((h) => h.id)
    let cs: Checkin[] = []
    if (ids.length > 0) {
      const { data, error: ce } = await supabase
        .from('habit_checkins')
        .select('habit_id, date, done')
        .in('habit_id', ids)
        .gte('date', firstDay)
      if (ce) { setError(ce.message); setLoading(false); return }
      cs = data as Checkin[]
    }
    setHabits(hs as Habit[])
    setCheckins(cs)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  function checkinOf(habitId: string, date: string): Checkin | undefined {
    return checkins.find((c) => c.habit_id === habitId && c.date === date)
  }

  function weekProgress(habitId: string): number {
    const currentWeek = weeks[weeks.length - 1]
    return currentWeek.filter((d) => checkinOf(habitId, d)?.done).length
  }

  // Ciclo por clique: sem registro → ✅ → ❌ → sem registro
  async function cycleCheckin(habit: Habit, date: string) {
    if (date > today) return
    setError(null)
    const current = checkinOf(habit.id, date)
    if (!current) {
      const { error } = await supabase
        .from('habit_checkins')
        .upsert({ habit_id: habit.id, date, done: true }, { onConflict: 'habit_id,date' })
      if (error) { setError(error.message); return }
    } else if (current.done) {
      const { error } = await supabase
        .from('habit_checkins')
        .update({ done: false })
        .eq('habit_id', habit.id)
        .eq('date', date)
      if (error) { setError(error.message); return }
    } else {
      const { error } = await supabase
        .from('habit_checkins')
        .delete()
        .eq('habit_id', habit.id)
        .eq('date', date)
      if (error) { setError(error.message); return }
    }
    await load()
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('habits').insert({
      user_id: newUserId,
      name: newName.trim(),
      target_per_week: parseInt(newTarget, 10),
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName(''); setNewTarget('3')
    await load()
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setError(null)
    const { error } = await supabase
      .from('habits')
      .update({ name: editName.trim(), target_per_week: parseInt(editTarget, 10) })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  async function handleArchive(habit: Habit) {
    setError(null)
    const { error } = await supabase.from('habits').update({ active: false }).eq('id', habit.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  function cellFace(habitId: string, date: string): string {
    const c = checkinOf(habitId, date)
    if (!c) return ''
    return c.done ? '✅' : '❌'
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Hábitos</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Novo hábito</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Nome</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input" placeholder="ex.: Academia" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Pessoa</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-xs font-medium text-muted">Vezes/semana</label>
            <input type="number" min="1" max="7" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} required className="input" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && habits.length === 0 && (
        <p className="text-sm text-muted">Nenhum hábito ativo — crie acima ou pelo chat.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {habits.map((h) => (
          <div key={h.id} className="card flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{h.name}</p>
                <p className="text-xs text-muted">
                  {userName(h.user_id)} · {weekProgress(h.id)}/{h.target_per_week} nessa semana
                </p>
              </div>
              <button
                onClick={() => { setEditing(h); setEditName(h.name); setEditTarget(String(h.target_per_week)) }}
                className="btn-ghost shrink-0"
              >
                Editar
              </button>
            </div>

            {/* Grade: WEEKS_SHOWN semanas (antiga → corrente), colunas seg→dom */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {DAY_LABELS.map((l, i) => (
                <span key={`l-${i}`} className="text-[10px] text-muted">{l}</span>
              ))}
              {weeks.flat().map((date) => (
                <button
                  key={date}
                  onClick={() => cycleCheckin(h, date)}
                  disabled={date > today}
                  title={date.split('-').reverse().slice(0, 2).join('/')}
                  className={`h-7 rounded text-xs grid place-items-center border border-hairline ${
                    date > today ? 'opacity-30' : 'hover:bg-surface-2'
                  } ${date === today ? 'ring-1 ring-brand-600' : ''}`}
                >
                  {cellFace(h.id, date)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar hábito" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required className="input" />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Vezes/semana</label>
              <input type="number" min="1" max="7" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} required className="input" />
            </div>
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => handleArchive(editing)} className="btn-ghost text-red-600">Arquivar</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
                <button type="submit" className="btn-primary">Salvar</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
