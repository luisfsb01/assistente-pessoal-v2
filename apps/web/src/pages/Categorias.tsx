import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatBrl } from '../lib/format'
import { Modal } from '../components/Modal'

interface Category {
  id: string
  name: string
  parent_id: string | null
  monthly_target: number | null
  type: 'income' | 'expense' | 'investment'
  counts: boolean
}

// ── Category modal state ──────────────────────────────────────────────────────
interface CatModal {
  open: boolean
  mode: 'create' | 'edit'
  id: string
  name: string
  type: 'income' | 'expense' | 'investment'
  meta: string // monetary string, '' = sem meta
  counts: boolean
  hasSubs: boolean // when editing a category that already has subcategories
  subsTarget: number | null // soma das metas das subcategorias (read-only display)
  saving: boolean
  error: string | null
}

const EMPTY_CAT_MODAL: CatModal = {
  open: false,
  mode: 'create',
  id: '',
  name: '',
  type: 'expense',
  meta: '',
  counts: true,
  hasSubs: false,
  subsTarget: null,
  saving: false,
  error: null,
}

// ── Subcategory modal state ───────────────────────────────────────────────────
interface SubModal {
  open: boolean
  mode: 'create' | 'edit'
  id: string
  name: string
  meta: string // monetary string, '' = sem meta
  rootId: string
  rootType: 'income' | 'expense' | 'investment'
  saving: boolean
  error: string | null
}

const EMPTY_SUB_MODAL: SubModal = {
  open: false,
  mode: 'create',
  id: '',
  name: '',
  meta: '',
  rootId: '',
  rootType: 'expense',
  saving: false,
  error: null,
}

export default function Categorias() {
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Which root cards are expanded (set of ids)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [catModal, setCatModal] = useState<CatModal>(EMPTY_CAT_MODAL)
  const [subModal, setSubModal] = useState<SubModal>(EMPTY_SUB_MODAL)

  // ── Data loading ────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, parent_id, monthly_target, type, counts')
      .order('name')
    if (error) {
      setLoadError(error.message)
      setLoading(false)
      return
    }
    setCats((data ?? []) as Category[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const roots = cats
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  function childrenOf(parentId: string): Category[] {
    return cats
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  // Meta efetiva: se a categoria tem subcategorias → soma das metas das subs
  // (null tratado como 0; se todas forem null, retorna null = sem meta).
  // Caso contrário → a própria meta da categoria.
  function effectiveTarget(cat: Category): number | null {
    const subs = childrenOf(cat.id)
    if (subs.length > 0) {
      const anySet = subs.some((s) => s.monthly_target != null)
      if (!anySet) return null
      return subs.reduce((acc, s) => acc + (s.monthly_target ?? 0), 0)
    }
    return cat.monthly_target
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Category modal helpers ──────────────────────────────────────────────────
  function openCreateCat() {
    setCatModal({ ...EMPTY_CAT_MODAL, open: true, mode: 'create' })
  }

  function openEditCat(cat: Category) {
    const subs = childrenOf(cat.id)
    const hasSubs = subs.length > 0
    const subsTarget = hasSubs ? effectiveTarget(cat) : null
    setCatModal({
      open: true,
      mode: 'edit',
      id: cat.id,
      name: cat.name,
      type: cat.type,
      meta: cat.monthly_target != null ? String(cat.monthly_target) : '',
      counts: cat.counts,
      hasSubs,
      subsTarget,
      saving: false,
      error: null,
    })
  }

  function closeCatModal() {
    setCatModal(EMPTY_CAT_MODAL)
  }

  async function handleSaveCat() {
    if (!catModal.name.trim()) {
      setCatModal((m) => ({ ...m, error: 'Nome obrigatório.' }))
      return
    }
    setCatModal((m) => ({ ...m, saving: true, error: null }))

    // Meta aplicável para ambos os tipos (despesa e receita).
    // Quando a categoria tem subcategorias, a meta é a soma das subs (derivada),
    // então não sobrescrevemos monthly_target da raiz.
    const monthly_target = catModal.meta.trim() !== '' ? Number(catModal.meta) : null

    const payload: {
      name: string
      type: 'income' | 'expense' | 'investment'
      counts: boolean
      parent_id: null
      monthly_target?: number | null
    } = {
      name: catModal.name.trim(),
      type: catModal.type,
      counts: catModal.counts,
      parent_id: null,
    }
    if (!catModal.hasSubs) {
      payload.monthly_target = monthly_target
    }

    let error
    if (catModal.mode === 'edit') {
      ;({ error } = await supabase.from('categories').update(payload).eq('id', catModal.id))
    } else {
      ;({ error } = await supabase.from('categories').insert(payload))
    }

    if (error) {
      setCatModal((m) => ({ ...m, saving: false, error: error!.message }))
      return
    }
    closeCatModal()
    await load()
  }

  // ── Subcategory modal helpers ───────────────────────────────────────────────
  function openCreateSub(root: Category) {
    setSubModal({
      open: true,
      mode: 'create',
      id: '',
      name: '',
      meta: '',
      rootId: root.id,
      rootType: root.type,
      saving: false,
      error: null,
    })
  }

  function openEditSub(sub: Category, root: Category) {
    setSubModal({
      open: true,
      mode: 'edit',
      id: sub.id,
      name: sub.name,
      meta: sub.monthly_target != null ? String(sub.monthly_target) : '',
      rootId: root.id,
      rootType: root.type,
      saving: false,
      error: null,
    })
  }

  function closeSubModal() {
    setSubModal(EMPTY_SUB_MODAL)
  }

  async function handleSaveSub() {
    if (!subModal.name.trim()) {
      setSubModal((m) => ({ ...m, error: 'Nome obrigatório.' }))
      return
    }
    setSubModal((m) => ({ ...m, saving: true, error: null }))

    const monthly_target = subModal.meta.trim() !== '' ? Number(subModal.meta) : null

    let error
    if (subModal.mode === 'edit') {
      ;({ error } = await supabase
        .from('categories')
        .update({ name: subModal.name.trim(), monthly_target })
        .eq('id', subModal.id))
    } else {
      ;({ error } = await supabase.from('categories').insert({
        name: subModal.name.trim(),
        parent_id: subModal.rootId,
        type: subModal.rootType,
        monthly_target,
      }))
    }

    if (error) {
      setSubModal((m) => ({ ...m, saving: false, error: error!.message }))
      return
    }
    closeSubModal()
    await load()
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Excluir "${name}"?`)) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) {
      const msg = error.message ?? ''
      const isFk =
        error.code === '23503' ||
        /foreign key|violates/i.test(msg)
      if (isFk) {
        alert('Não dá para excluir: em uso por lançamentos ou possui subcategorias.')
      } else {
        alert(msg)
      }
      return
    }
    await load()
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  if (loading) {
    return <p className="text-sm text-muted">Carregando…</p>
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
        {loadError}
      </div>
    )
  }

  const expenseRoots = roots.filter((c) => c.type === 'expense')
  const incomeRoots = roots.filter((c) => c.type === 'income')
  const investmentRoots = roots.filter((c) => c.type === 'investment')

  function RootCard({ root }: { root: Category }) {
    const isOpen = expanded.has(root.id)
    const subs = childrenOf(root.id)
    const meta = effectiveTarget(root)

    return (
      <div className="card p-0 overflow-hidden">
        {/* Header row */}
        <button
          className="w-full flex items-center gap-2 p-4 text-left group"
          onClick={() => toggleExpand(root.id)}
        >
          <span className="text-muted text-xs leading-none select-none w-3 shrink-0">
            {isOpen ? '▾' : '▸'}
          </span>
          <span className="font-medium text-ink flex-1 text-sm">{root.name}</span>

          {/* Tag "fora dos totais" quando counts=false */}
          {!root.counts && (
            <span className="bg-surface border border-hairline text-muted text-xs rounded-full px-2 py-0.5 shrink-0">
              fora dos totais
            </span>
          )}

          {/* Meta badge (despesa e receita) — soma das subs quando houver */}
          {meta != null && (
            <span className="bg-accent-soft text-accent-soft-ink text-xs rounded-full px-2 py-0.5 shrink-0">
              Meta: {formatBrl(meta)}
            </span>
          )}

          {/* Action buttons */}
          <span
            className="flex items-center gap-2 ml-2 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => openEditCat(root)}
              className="text-muted hover:text-ink transition-colors text-sm"
              title="Editar"
            >
              ✏️
            </button>
            <button
              onClick={() => handleDelete(root.id, root.name)}
              className="text-muted hover:text-ink transition-colors text-sm"
              title="Excluir"
            >
              🗑
            </button>
          </span>
        </button>

        {/* Subcategories (expanded) */}
        {isOpen && (
          <div className="px-4 pb-4">
            {subs.length > 0 && (
              <ul className="border-l border-hairline ml-2 pl-3 space-y-1 mb-3">
                {subs.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2 py-0.5">
                    <span className="text-sm text-ink flex-1">{sub.name}</span>
                    {sub.monthly_target != null && (
                      <span className="bg-accent-soft text-accent-soft-ink text-xs rounded-full px-2 py-0.5 shrink-0">
                        Meta: {formatBrl(sub.monthly_target)}
                      </span>
                    )}
                    <button
                      onClick={() => openEditSub(sub, root)}
                      className="text-muted hover:text-ink transition-colors text-xs"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(sub.id, sub.name)}
                      className="text-muted hover:text-ink transition-colors text-xs"
                      title="Excluir"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add subcategory button */}
            <button
              onClick={() => openCreateSub(root)}
              className="border border-dashed border-hairline rounded-lg text-sm text-muted hover:text-ink hover:border-brand-500 w-full py-1.5 transition-colors"
            >
              + Adicionar subcategoria
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Categorias</h1>
          <p className="text-sm text-muted mt-0.5">Organize seus gastos e receitas</p>
        </div>
        <button onClick={openCreateCat} className="btn-primary">
          + Nova categoria
        </button>
      </div>

      {/* Three-column grid */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* Despesas column */}
        <div>
          <p className="font-semibold text-ink text-sm mb-3">📉 Despesas</p>
          {expenseRoots.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma categoria de despesa.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {expenseRoots.map((root) => (
                <RootCard key={root.id} root={root} />
              ))}
            </div>
          )}
        </div>

        {/* Receitas column */}
        <div>
          <p className="font-semibold text-ink text-sm mb-3">📈 Receitas</p>
          {incomeRoots.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma categoria de receita.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {incomeRoots.map((root) => (
                <RootCard key={root.id} root={root} />
              ))}
            </div>
          )}
        </div>

        {/* Investimentos column */}
        <div>
          <p className="font-semibold text-ink text-sm mb-3">📊 Investimentos</p>
          {investmentRoots.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma categoria de investimento.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {investmentRoots.map((root) => (
                <RootCard key={root.id} root={root} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Category Modal ─────────────────────────────────────────────────── */}
      {catModal.open && (
        <Modal
          title={catModal.mode === 'create' ? 'Nova categoria' : 'Editar categoria'}
          onClose={closeCatModal}
          footer={
            <>
              <button onClick={closeCatModal} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={handleSaveCat} disabled={catModal.saving} className="btn-primary">
                {catModal.saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {/* Nome */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">Nome</label>
            <input
              type="text"
              value={catModal.name}
              onChange={(e) => setCatModal((m) => ({ ...m, name: e.target.value }))}
              placeholder="ex.: Alimentação"
              className="input"
              autoFocus
            />
          </div>

          {/* Tipo */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">Tipo</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCatModal((m) => ({ ...m, type: 'expense' }))}
                className={[
                  'flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
                  catModal.type === 'expense'
                    ? 'bg-accent-soft text-accent-soft-ink border-brand-500'
                    : 'bg-surface border-hairline text-muted hover:text-ink',
                ].join(' ')}
              >
                Despesa
              </button>
              <button
                type="button"
                onClick={() => setCatModal((m) => ({ ...m, type: 'income' }))}
                className={[
                  'flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
                  catModal.type === 'income'
                    ? 'bg-accent-soft text-accent-soft-ink border-brand-500'
                    : 'bg-surface border-hairline text-muted hover:text-ink',
                ].join(' ')}
              >
                Receita
              </button>
              <button
                type="button"
                onClick={() => setCatModal((m) => ({ ...m, type: 'investment' }))}
                className={[
                  'flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
                  catModal.type === 'investment'
                    ? 'bg-accent-soft text-accent-soft-ink border-brand-500'
                    : 'bg-surface border-hairline text-muted hover:text-ink',
                ].join(' ')}
              >
                Investimento
              </button>
            </div>
          </div>

          {/* Meta Mensal — despesa e receita */}
          {catModal.hasSubs ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Meta Mensal (R$)
              </label>
              <p className="text-sm text-muted">
                Meta (soma das subcategorias):{' '}
                <span className="text-ink font-medium">
                  {formatBrl(catModal.subsTarget ?? 0)}
                </span>
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Meta Mensal (R$)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={catModal.meta}
                onChange={(e) => setCatModal((m) => ({ ...m, meta: e.target.value }))}
                placeholder="0,00"
                className="input"
              />
            </div>
          )}

          {/* Contabilizar nos totais */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={catModal.counts}
                onChange={(e) => setCatModal((m) => ({ ...m, counts: e.target.checked }))}
                className="h-4 w-4 rounded border-hairline accent-brand-500"
              />
              <span className="text-sm text-ink">Contabilizar nos totais</span>
            </label>
            <p className="text-xs text-muted">
              Quando desativado, esta categoria (e suas subcategorias) fica fora dos totais.
            </p>
          </div>

          {catModal.error && (
            <p className="text-sm text-red-500">{catModal.error}</p>
          )}
        </Modal>
      )}

      {/* ── Subcategory Modal ──────────────────────────────────────────────── */}
      {subModal.open && (
        <Modal
          title={subModal.mode === 'create' ? 'Nova subcategoria' : 'Editar subcategoria'}
          onClose={closeSubModal}
          footer={
            <>
              <button onClick={closeSubModal} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={handleSaveSub} disabled={subModal.saving} className="btn-primary">
                {subModal.saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">Nome</label>
            <input
              type="text"
              value={subModal.name}
              onChange={(e) => setSubModal((m) => ({ ...m, name: e.target.value }))}
              placeholder="ex.: Restaurantes"
              className="input"
              autoFocus
            />
          </div>

          {/* Meta Mensal */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">
              Meta Mensal (R$)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={subModal.meta}
              onChange={(e) => setSubModal((m) => ({ ...m, meta: e.target.value }))}
              placeholder="0,00"
              className="input"
            />
          </div>

          {subModal.error && (
            <p className="text-sm text-red-500">{subModal.error}</p>
          )}
        </Modal>
      )}
    </div>
  )
}
