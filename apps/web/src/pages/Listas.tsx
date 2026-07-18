import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'

type Tab = 'shopping' | 'travel' | 'prayer'
type ShoppingItem = { id: string; name: string }
type TravelItem = { id: string; name: string }
type TravelList = { id: string; name: string; travel_date: string; travel_items: TravelItem[] }
type PrayerRequest = { id: string; owner_id: string; purpose: string | null; person_name: string; request: string }

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'shopping', label: 'Compras', icon: '🛒' },
  { id: 'travel', label: 'Viagens', icon: '🧳' },
  { id: 'prayer', label: 'Pedidos de oração', icon: '🙏' },
]

function formatDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

export default function Listas() {
  const [tab, setTab] = useState<Tab>('shopping')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink">Listas</h1>
        <p className="mt-1 text-sm text-muted">Compras e viagens são do casal. Pedidos de oração ficam separados por pessoa.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipos de lista">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => { setTab(item.id); setError(null) }}
            className={tab === item.id ? 'btn-primary' : 'btn-ghost border border-hairline'}
          >
            <span aria-hidden="true">{item.icon}</span> {item.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {tab === 'shopping' && <ShoppingList onError={setError} />}
      {tab === 'travel' && <TravelLists onError={setError} />}
      {tab === 'prayer' && <PrayerLists onError={setError} />}
    </div>
  )
}

function ShoppingList({ onError }: { onError: (message: string | null) => void }) {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('shopping_items').select('id, name').order('created_at')
    setLoading(false)
    if (error) return onError(error.message)
    setItems((data ?? []) as ShoppingItem[])
  }
  useEffect(() => { void load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    const { error } = await supabase.from('shopping_items').insert({ name: newName.trim() })
    setSaving(false)
    if (error) return onError(error.message)
    setNewName('')
    await load()
  }

  async function remove(id: string) {
    const { error } = await supabase.from('shopping_items').delete().eq('id', id)
    if (error) return onError(error.message)
    setItems((current) => current.filter((item) => item.id !== id))
  }

  async function edit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    const { error } = await supabase.from('shopping_items').update({ name: editName.trim() }).eq('id', editing.id)
    if (error) return onError(error.message)
    setEditing(null)
    await load()
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Lista de compras">
      <form onSubmit={add} className="flex gap-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="ex.: Café" className="input flex-1" />
        <button disabled={saving} className="btn-primary">{saving ? 'Adicionando…' : 'Adicionar'}</button>
      </form>
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Lista vazia.</p>}
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="card flex items-center gap-3 py-3">
            <button onClick={() => void remove(item.id)} className="w-6 h-6 rounded-full border border-hairline hover:bg-surface-2" title="Comprado" />
            <span className="flex-1 text-sm text-ink">{item.name}</span>
            <button onClick={() => { setEditing(item); setEditName(item.name) }} className="btn-ghost">Editar</button>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title="Editar item" onClose={() => setEditing(null)}>
          <form onSubmit={edit} className="grid gap-3">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

function TravelLists({ onError }: { onError: (message: string | null) => void }) {
  const [lists, setLists] = useState<TravelList[]>([])
  const [travelName, setTravelName] = useState('')
  const [travelDate, setTravelDate] = useState('')
  const [itemName, setItemName] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('travel_lists')
      .select('id, name, travel_date, travel_items ( id, name )')
      .order('travel_date')
    setLoading(false)
    if (error) return onError(error.message)
    setLists((data ?? []) as TravelList[])
  }
  useEffect(() => { void load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = travelName.trim()
    const item = itemName.trim()
    if (!name || !travelDate || !item) return
    let list = lists.find((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase() && entry.travel_date === travelDate)
    if (!list) {
      const { data, error } = await supabase.from('travel_lists').insert({ name, travel_date: travelDate }).select('id, name, travel_date').single()
      if (error) return onError(error.message)
      list = { ...(data as Omit<TravelList, 'travel_items'>), travel_items: [] }
    }
    const { error } = await supabase.from('travel_items').insert({ travel_list_id: list.id, name: item })
    if (error) return onError(error.message)
    setItemName('')
    await load()
  }

  async function removeItem(id: string) {
    const { error } = await supabase.from('travel_items').delete().eq('id', id)
    if (error) return onError(error.message)
    await load()
  }

  async function removeList(id: string, name: string) {
    if (!window.confirm(`Apagar a lista da viagem “${name}”?`)) return
    const { error } = await supabase.from('travel_lists').delete().eq('id', id)
    if (error) return onError(error.message)
    await load()
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Listas de viagem">
      <form onSubmit={add} className="card grid gap-3 md:grid-cols-[1fr_10rem_1fr_auto] items-end">
        <label className="grid gap-1 text-sm text-muted">Viagem<input value={travelName} onChange={(e) => setTravelName(e.target.value)} placeholder="ex.: Recife" required className="input" /></label>
        <label className="grid gap-1 text-sm text-muted">Data<input type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} required className="input" /></label>
        <label className="grid gap-1 text-sm text-muted">Item<input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="ex.: Carregador" required className="input" /></label>
        <button className="btn-primary">Adicionar</button>
      </form>
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && lists.length === 0 && <p className="text-sm text-muted">Nenhuma viagem cadastrada.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {lists.map((list) => (
          <article key={list.id} className="card flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="flex-1"><h2 className="font-semibold text-ink">{list.name}</h2><p className="text-xs text-muted">{formatDate(list.travel_date)}</p></div>
              <button onClick={() => void removeList(list.id, list.name)} className="btn-ghost text-red-600">Apagar</button>
            </div>
            {list.travel_items.length === 0 && <p className="text-sm text-muted">Sem itens.</p>}
            {list.travel_items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <button onClick={() => void removeItem(item.id)} className="w-5 h-5 rounded-full border border-hairline" title="Remover item" />
                <span>{item.name}</span>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}

function PrayerLists({ onError }: { onError: (message: string | null) => void }) {
  const { users, error: usersError } = useUsers()
  const [requests, setRequests] = useState<PrayerRequest[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [personName, setPersonName] = useState('')
  const [request, setRequest] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (!ownerId && users[0]) setOwnerId(users[0].id) }, [ownerId, users])
  useEffect(() => { if (usersError) onError(usersError) }, [onError, usersError])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('prayer_requests').select('id, owner_id, purpose, person_name, request').order('created_at')
    setLoading(false)
    if (error) return onError(error.message)
    setRequests((data ?? []) as PrayerRequest[])
  }
  useEffect(() => { void load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!ownerId || !personName.trim() || !request.trim()) return
    const { error } = await supabase.from('prayer_requests').insert({ owner_id: ownerId, purpose: purpose.trim() || null, person_name: personName.trim(), request: request.trim() })
    if (error) return onError(error.message)
    setPersonName(''); setRequest('')
    await load()
  }

  async function remove(id: string) {
    const { error } = await supabase.from('prayer_requests').delete().eq('id', id)
    if (error) return onError(error.message)
    setRequests((current) => current.filter((item) => item.id !== id))
  }

  const grouped = useMemo(() => users.map((user) => ({
    user,
    groups: Array.from(new Set(requests.filter((item) => item.owner_id === user.id).map((item) => item.purpose ?? 'Geral')))
      .map((name) => ({ name, items: requests.filter((item) => item.owner_id === user.id && (item.purpose ?? 'Geral') === name) })),
  })), [requests, users])

  return (
    <section className="flex flex-col gap-5" aria-label="Pedidos de oração">
      <form onSubmit={add} className="card grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm text-muted">Lista de<select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required className="input"><option value="">Selecione</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm text-muted">Propósito (opcional)<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Geral se ficar em branco" className="input" /></label>
        <label className="grid gap-1 text-sm text-muted">Nome da pessoa<input value={personName} onChange={(e) => setPersonName(e.target.value)} required className="input" /></label>
        <label className="grid gap-1 text-sm text-muted">Pedido de oração<input value={request} onChange={(e) => setRequest(e.target.value)} required className="input" /></label>
        <button className="btn-primary md:col-span-2 justify-self-end">Adicionar pedido</button>
      </form>
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      <div className="grid gap-5 md:grid-cols-2">
        {grouped.map(({ user, groups }) => (
          <article key={user.id} className="card flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-ink">Pedidos de {user.name}</h2>
            {!loading && groups.length === 0 && <p className="text-sm text-muted">Nenhum pedido.</p>}
            {groups.map((group) => (
              <div key={group.name} className="grid gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{group.name}</h3>
                {group.items.map((item) => (
                  <div key={item.id} className="flex gap-3 border-t border-hairline pt-2">
                    <div className="flex-1 text-sm"><strong>{item.person_name}</strong><p className="text-muted">{item.request}</p></div>
                    <button onClick={() => void remove(item.id)} className="btn-ghost text-red-600">Remover</button>
                  </div>
                ))}
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}
