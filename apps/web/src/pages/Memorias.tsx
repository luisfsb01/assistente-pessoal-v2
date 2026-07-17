import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { Modal } from '../components/Modal'

interface Memory {
  id: string
  subject: 'luis' | 'esposa' | 'casal'
  type: 'preference' | 'habit' | 'fact' | 'decision' | 'person'
  content: string
  active: boolean
  expires_at: string | null
  updated_at: string
}

const SUBJECT_LABEL: Record<Memory['subject'], string> = {
  luis: 'Luis', esposa: 'Esposa', casal: 'Casal',
}
const TYPE_LABEL: Record<Memory['type'], string> = {
  preference: 'preferência', habit: 'hábito', fact: 'fato', decision: 'decisão', person: 'pessoa',
}
const PAGE = 100

export default function Memorias() {
  const [items, setItems] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const [editing, setEditing] = useState<Memory | null>(null)
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState<Memory | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('memories')
      .select('id, subject, type, content, active, expires_at, updated_at')
    if (subjectFilter !== 'all') q = q.eq('subject', subjectFilter)
    if (typeFilter !== 'all') q = q.eq('type', typeFilter)
    if (statusFilter !== 'all') q = q.eq('active', statusFilter === 'active')
    if (query.trim()) q = q.ilike('content', `%${query.trim()}%`)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit + 1)
    if (error) { setError(error.message); setLoading(false); return }
    const rows = data as Memory[]
    setHasMore(rows.length > limit)
    setItems(rows.slice(0, limit))
    setLoading(false)
  }

  useEffect(() => { load() }, [subjectFilter, typeFilter, statusFilter, query, limit])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    setLimit(PAGE)
    setQuery(search)
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editContent.trim()) return
    setSavingEdit(true)
    setError(null)
    let res: Response
    try {
      res = await apiFetch(`/api/memories/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent.trim() }),
      })
    } catch {
      setError('Erro de rede ao salvar a memória — tente de novo.')
      return
    } finally {
      setSavingEdit(false)
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      setError(body?.error ?? `Erro ${res.status} ao salvar a memória`)
      return
    }
    setEditing(null)
    await load()
  }

  async function toggleActive(m: Memory) {
    setError(null)
    const { error } = await supabase.from('memories').update({ active: !m.active }).eq('id', m.id)
    if (error) { setError(error.message); return }
    await load()
  }

  async function handleDelete() {
    if (!deleting) return
    setError(null)
    const { error } = await supabase.from('memories').delete().eq('id', deleting.id)
    if (error) { setError(error.message); return }
    setDeleting(null)
    await load()
  }

  const isExpired = (m: Memory) => m.expires_at != null && new Date(m.expires_at) <= new Date()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Memórias</h1>
        <p className="text-sm text-muted mt-1">Tudo que o assistente sabe — edite, desative ou apague</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <form onSubmit={submitSearch} className="flex gap-2 flex-1 min-w-[220px]">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no conteúdo…" className="input flex-1" />
          <button type="submit" className="btn-primary shrink-0">Buscar</button>
        </form>
        <select value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); setLimit(PAGE) }} className="input w-32">
          <option value="all">Todos</option>
          <option value="luis">Luis</option>
          <option value="esposa">Esposa</option>
          <option value="casal">Casal</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setLimit(PAGE) }} className="input w-36">
          <option value="all">Todos os tipos</option>
          <option value="preference">Preferência</option>
          <option value="habit">Hábito</option>
          <option value="fact">Fato</option>
          <option value="decision">Decisão</option>
          <option value="person">Pessoa</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setLimit(PAGE) }} className="input w-32">
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhuma memória encontrada.</p>}

      <div className="flex flex-col gap-2">
        {items.map((m) => (
          <div key={m.id} className={`card flex items-start gap-3 py-3 ${m.active ? '' : 'opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink">{m.content}</p>
              <p className="text-xs text-muted mt-1">
                {SUBJECT_LABEL[m.subject]} · {TYPE_LABEL[m.type]}
                {!m.active && ' · inativa'}
                {isExpired(m) && ' · expirada'}
              </p>
            </div>
            <button onClick={() => { setEditing(m); setEditContent(m.content) }} className="btn-ghost shrink-0">Editar</button>
            <button onClick={() => toggleActive(m)} className="btn-ghost shrink-0">
              {m.active ? 'Desativar' : 'Reativar'}
            </button>
            <button onClick={() => setDeleting(m)} className="btn-ghost shrink-0 text-red-600">Excluir</button>
          </div>
        ))}
      </div>

      {hasMore && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost self-center">
          Carregar mais
        </button>
      )}

      {editing && (
        <Modal title="Editar memória" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              required
              rows={4}
              className="input"
            />
            <p className="text-xs text-muted">Salvar regera o embedding (uma chamada barata de LLM).</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" disabled={savingEdit} className="btn-primary">
                {savingEdit ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Excluir memória"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleDelete} className="btn-primary">Excluir de vez</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir definitivamente esta memória? (Para o assistente só "esquecer", use Desativar.)</p>
        </Modal>
      )}
    </div>
  )
}
