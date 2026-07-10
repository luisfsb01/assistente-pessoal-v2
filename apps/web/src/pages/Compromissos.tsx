import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatBrl } from '../lib/format'

interface Commitment {
  id: string
  description: string
  amount: number | null
  day_of_month: number
  active: boolean
}

export default function Compromissos() {
  const [items, setItems] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Create form
  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDay, setNewDay] = useState('1')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Deactivate errors per id
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('financial_commitments')
      .select('*')
      .eq('active', true)
      .order('day_of_month')
    if (error) { setLoadError(error.message); setLoading(false); return }
    setItems(data as Commitment[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDeactivate(id: string) {
    setDeactivateError(null)
    const { error } = await supabase
      .from('financial_commitments')
      .update({ active: false })
      .eq('id', id)
    if (error) { setDeactivateError(error.message); return }
    setItems((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    if (!newDesc.trim()) return
    setCreating(true)
    const day = parseInt(newDay, 10)
    const amount = newAmount.trim() === '' ? null : parseFloat(newAmount)
    const { error } = await supabase.from('financial_commitments').insert({
      description: newDesc.trim(),
      amount,
      day_of_month: day,
      active: true,
    })
    setCreating(false)
    if (error) { setCreateError(error.message); return }
    setNewDesc('')
    setNewAmount('')
    setNewDay('1')
    await load()
  }

  if (loading) {
    return <p className="text-sm text-muted">Carregando…</p>
  }

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Compromissos financeiros</h1>

      {/* Create form */}
      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Novo compromisso</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs font-medium text-muted">Descrição</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              required
              placeholder="ex.: Aluguel"
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-xs font-medium text-muted">Valor (opcional)</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted shrink-0">R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 w-24">
            <label className="text-xs font-medium text-muted">Dia do mês</label>
            <input
              type="number"
              min="1"
              max="28"
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
              required
              className="input"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="btn-primary"
          >
            {creating ? 'Criando…' : 'Criar'}
          </button>
        </form>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </div>

      {deactivateError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 border border-red-200">
          {deactivateError}
        </p>
      )}

      {/* List */}
      <div className="flex flex-col gap-3">
        {items.length === 0 && (
          <p className="text-sm text-muted">Nenhum compromisso ativo.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="card flex items-center gap-4 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-ink">
                Dia {item.day_of_month}: {item.description}
              </span>
              {item.amount != null && (
                <span className="ml-2 text-sm text-muted">{formatBrl(item.amount)}</span>
              )}
            </div>
            <button
              onClick={() => handleDeactivate(item.id)}
              className="btn-ghost shrink-0"
            >
              Desativar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
