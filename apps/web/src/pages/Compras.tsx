import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'

interface ShoppingItem {
  id: string
  name: string
}

export default function Compras() {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('shopping_items')
      .select('id, name')
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setItems(data as ShoppingItem[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('shopping_items').insert({ name: newName.trim() })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName('')
    await load()
  }

  // "Comprado" = sai da lista (a tabela não tem status; mesmo comportamento do chat)
  async function handleBought(id: string) {
    setError(null)
    const { error } = await supabase.from('shopping_items').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setError(null)
    const { error } = await supabase
      .from('shopping_items')
      .update({ name: editName.trim() })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-bold text-ink">Lista de compras</h1>

      <form onSubmit={handleAdd} className="flex gap-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          placeholder="ex.: Café"
          className="input flex-1"
        />
        <button type="submit" disabled={saving} className="btn-primary shrink-0">
          {saving ? 'Adicionando…' : 'Adicionar'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Lista vazia. 🎉</p>}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="card flex items-center gap-3 py-3">
            <button
              onClick={() => handleBought(item.id)}
              className="shrink-0 w-6 h-6 rounded-full border border-hairline hover:bg-surface-2"
              title="Comprado (remove da lista)"
            />
            <span className="flex-1 text-sm text-ink">{item.name}</span>
            <button
              onClick={() => { setEditing(item); setEditName(item.name) }}
              className="btn-ghost shrink-0"
            >
              Editar
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar item" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
