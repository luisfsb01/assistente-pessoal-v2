import { useState } from 'react'
import { useGoals, createGoal, updateGoal, deleteGoal, type Goal } from '../lib/useGoals'
import { Modal } from '../components/Modal'
import GoalCard from '../components/GoalCard'

interface ModalState {
  mode: 'create' | 'edit'
  id?: string
  name: string
  target: string
  current: string
}

export default function Objetivos() {
  const { goals, loading, error, reload } = useGoals()
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function openCreate() {
    setModalState({ mode: 'create', name: '', target: '', current: '0' })
    setSaveError(null)
  }

  function openEdit(goal: Goal) {
    setModalState({
      mode: 'edit',
      id: goal.id,
      name: goal.name,
      target: String(goal.target_amount),
      current: String(goal.current_amount),
    })
    setSaveError(null)
  }

  function closeModal() {
    setModalState(null)
    setSaveError(null)
  }

  function set(field: keyof ModalState, value: string) {
    setModalState((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function handleSave() {
    if (!modalState) return
    const name = modalState.name.trim()
    const target = Number(modalState.target)
    if (!name) { setSaveError('Título é obrigatório.'); return }
    if (!(target > 0)) { setSaveError('Valor Meta deve ser maior que zero.'); return }

    const payload = {
      name,
      target_amount: target,
      current_amount: Number(modalState.current) || 0,
      deadline: null,
    }

    setSaving(true)
    setSaveError(null)
    try {
      if (modalState.mode === 'create') {
        await createGoal(payload)
      } else if (modalState.id) {
        await updateGoal(modalState.id, payload)
      }
      await reload()
      closeModal()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteGoal() {
    if (!deletingGoal) return
    setDeleteError(null)
    try {
      await deleteGoal(deletingGoal.id)
      setDeletingGoal(null)
      await reload()
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Erro ao excluir.')
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-ink">Objetivos Financeiros</h1>
          <p className="text-muted mt-1">
            Defina e acompanhe suas metas financeiras (ex: Viagem, Carro Novo).
          </p>
        </div>
        <button className="btn-primary shrink-0" onClick={openCreate}>
          Novo Objetivo
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <p className="text-muted">Carregando…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : goals.length === 0 ? (
        <div className="card text-muted">Nenhum objetivo ainda. Crie o primeiro!</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => openEdit(goal)}
              onDelete={() => { setDeletingGoal(goal); setDeleteError(null) }}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalState && (
        <Modal
          title={modalState.mode === 'create' ? 'Novo Objetivo' : 'Editar Objetivo'}
          onClose={closeModal}
          footer={
            <>
              <button className="btn-ghost" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
          <label className="grid gap-1">
            <span className="text-sm text-muted">Título</span>
            <input
              className="input"
              value={modalState.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex: Viagem, Carro..."
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-muted">Valor Meta (R$)</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={modalState.target}
              onChange={(e) => set('target', e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-muted">Valor Já Guardado (R$)</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={modalState.current}
              onChange={(e) => set('current', e.target.value)}
              placeholder="0,00"
            />
          </label>
        </Modal>
      )}

      {/* Delete Modal */}
      {deletingGoal && (
        <Modal
          title="Excluir objetivo"
          onClose={() => { setDeletingGoal(null); setDeleteError(null) }}
          footer={
            <>
              <button onClick={() => { setDeletingGoal(null); setDeleteError(null) }} className="btn-ghost">Cancelar</button>
              <button onClick={confirmDeleteGoal} className="btn-primary">Excluir</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir o objetivo "{deletingGoal.name}"?</p>
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
        </Modal>
      )}
    </div>
  )
}
