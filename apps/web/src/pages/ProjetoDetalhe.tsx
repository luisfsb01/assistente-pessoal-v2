import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'

interface Project {
  id: string
  name: string
  status: string | null
  active: boolean
}

interface PTask {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
  due_date: string | null
}

interface PNote {
  id: string
  kind: 'status' | 'decision' | 'note'
  content: string
  created_at: string
}

const COLUMNS: Array<{ key: PTask['status']; label: string }> = [
  { key: 'todo', label: 'A fazer' },
  { key: 'doing', label: 'Fazendo' },
  { key: 'done', label: 'Feito' },
]

const KIND_LABEL: Record<PNote['kind'], string> = {
  status: 'status', decision: 'decisão', note: 'nota',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDue(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return ` · até ${d}/${m}`
}

export default function ProjetoDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<PTask[]>([])
  const [notes, setNotes] = useState<PNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newTask, setNewTask] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newNoteKind, setNewNoteKind] = useState<PNote['kind']>('note')
  const [statusDraft, setStatusDraft] = useState('')
  const [archiving, setArchiving] = useState(false)

  async function touchProject() {
    const { error } = await supabase
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) setError(error.message)
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { data: p, error: pe } = await supabase
      .from('projects')
      .select('id, name, status, active')
      .eq('id', id)
      .maybeSingle()
    if (pe) { setError(pe.message); setLoading(false); return }
    if (!p) { setError('Projeto não encontrado.'); setLoading(false); return }
    const [{ data: ts, error: te }, { data: ns, error: ne }] = await Promise.all([
      supabase.from('project_tasks').select('id, title, status, due_date').eq('project_id', id).order('created_at'),
      supabase.from('project_notes').select('id, kind, content, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(30),
    ])
    if (te) { setError(te.message); setLoading(false); return }
    if (ne) { setError(ne.message); setLoading(false); return }
    setProject(p as Project)
    setStatusDraft((p as Project).status ?? '')
    setTasks(ts as PTask[])
    setNotes(ns as PNote[])
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function moveTask(t: PTask, dir: -1 | 1) {
    const order: PTask['status'][] = ['todo', 'doing', 'done']
    const next = order[order.indexOf(t.status) + dir]
    if (!next) return
    setError(null)
    const { error } = await supabase
      .from('project_tasks')
      .update({ status: next, done_at: next === 'done' ? new Date().toISOString() : null })
      .eq('id', t.id)
    if (error) { setError(error.message); return }
    await touchProject()
    await load()
  }

  async function deleteTask(t: PTask) {
    setError(null)
    const { error } = await supabase.from('project_tasks').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    await touchProject()
    await load()
  }

  async function handleAddTask(e: FormEvent) {
    e.preventDefault()
    if (!newTask.trim()) return
    setError(null)
    const { error } = await supabase.from('project_tasks').insert({
      project_id: id,
      title: newTask.trim(),
      due_date: newTaskDue || null,
    })
    if (error) { setError(error.message); return }
    setNewTask(''); setNewTaskDue('')
    await touchProject()
    await load()
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault()
    if (!newNote.trim()) return
    setError(null)
    const { error } = await supabase.from('project_notes').insert({
      project_id: id,
      kind: newNoteKind,
      content: newNote.trim(),
    })
    if (error) { setError(error.message); return }
    setNewNote('')
    await touchProject()
    await load()
  }

  // Status novo = campo do projeto + entrada na linha do tempo (espelha o chat)
  async function handleSaveStatus(e: FormEvent) {
    e.preventDefault()
    const status = statusDraft.trim()
    if (!status || status === (project?.status ?? '')) return
    setError(null)
    const { error } = await supabase.from('projects').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { setError(error.message); return }
    const { error: ne } = await supabase.from('project_notes').insert({ project_id: id, kind: 'status', content: status })
    if (ne) { setError(ne.message); return }
    await load()
  }

  async function handleArchive() {
    setError(null)
    const { error } = await supabase
      .from('projects')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { setError(error.message); return }
    navigate('/projetos')
  }

  if (loading) return <p className="text-sm text-muted">Carregando…</p>
  if (!project) return <p className="text-sm text-red-600">{error ?? 'Projeto não encontrado.'}</p>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/projetos" className="btn-ghost shrink-0">←</Link>
        <h1 className="text-2xl font-bold text-ink flex-1">{project.name}</h1>
        <button onClick={() => setArchiving(true)} className="btn-ghost text-red-600 shrink-0">Arquivar</button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Status atual */}
      <form onSubmit={handleSaveStatus} className="card flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
          <label className="text-xs font-medium text-muted">Status atual</label>
          <input type="text" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} className="input" placeholder="ex.: aguardando cliente" />
        </div>
        <button type="submit" className="btn-primary">Atualizar status</button>
      </form>

      {/* Quadro */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.key} className="card flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {col.label} ({tasks.filter((t) => t.status === col.key).length})
            </h3>
            {tasks.filter((t) => t.status === col.key).map((t) => (
              <div key={t.id} className="rounded-lg border border-hairline px-3 py-2 flex items-center gap-2">
                <span className={`flex-1 text-sm ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>
                  {t.title}<span className="text-xs text-muted">{formatDue(t.due_date)}</span>
                </span>
                {t.status !== 'todo' && (
                  <button onClick={() => moveTask(t, -1)} className="btn-ghost px-1" title="Mover para trás">←</button>
                )}
                {t.status !== 'done' && (
                  <button onClick={() => moveTask(t, 1)} className="btn-ghost px-1" title="Avançar">→</button>
                )}
                <button onClick={() => deleteTask(t)} className="btn-ghost px-1 text-red-600" title="Excluir">×</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Nova tarefa */}
      <form onSubmit={handleAddTask} className="card flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted">Nova tarefa</label>
          <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} required className="input" placeholder="ex.: enviar proposta" />
        </div>
        <div className="flex flex-col gap-1 w-40">
          <label className="text-xs font-medium text-muted">Prazo (opcional)</label>
          <input type="date" value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} className="input" />
        </div>
        <button type="submit" className="btn-primary">Adicionar</button>
      </form>

      {/* Linha do tempo */}
      <div className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Linha do tempo</h3>
        <form onSubmit={handleAddNote} className="flex flex-wrap gap-3">
          <select value={newNoteKind} onChange={(e) => setNewNoteKind(e.target.value as PNote['kind'])} className="input w-32">
            <option value="note">Nota</option>
            <option value="decision">Decisão</option>
          </select>
          <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)} required className="input flex-1 min-w-[200px]" placeholder="ex.: decidi usar Astro" />
          <button type="submit" className="btn-primary">Registrar</button>
        </form>
        {notes.length === 0 && <p className="text-sm text-muted">Sem registros ainda.</p>}
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm text-ink flex gap-2">
              <span className="text-xs text-muted shrink-0 w-12">{formatDate(n.created_at)}</span>
              <span className="text-xs text-muted shrink-0 w-16">[{KIND_LABEL[n.kind]}]</span>
              <span className="flex-1">{n.content}</span>
            </li>
          ))}
        </ul>
      </div>

      {archiving && (
        <Modal
          title="Arquivar projeto"
          onClose={() => setArchiving(false)}
          footer={
            <>
              <button onClick={() => setArchiving(false)} className="btn-ghost">Cancelar</button>
              <button onClick={handleArchive} className="btn-primary">Arquivar</button>
            </>
          }
        >
          <p className="text-sm text-ink">Arquivar "{project.name}"? Ele some da lista e do acompanhamento.</p>
        </Modal>
      )}
    </div>
  )
}
