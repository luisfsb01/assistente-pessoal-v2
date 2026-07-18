import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upsertRule } from '../lib/rules'
import { formatBrl } from '../lib/format'
import { type PeriodKey, PERIOD_LABELS, periodRange } from '../lib/period'
import type { Category } from '../lib/finance-data'
import { Modal } from '../components/Modal'
import { Pencil, Trash2 } from 'lucide-react'
import { useColumnWidths } from '../lib/useColumnWidths'
import { ResizableHeader } from '../components/ResizableHeader'
import { fetchAllPages } from '../lib/fetch-all-pages'

// Colunas de conteúdo redimensionáveis (na ordem em que aparecem)
const TX_COLS = ['data', 'descricao', 'categoria', 'subcategoria', 'valor', 'origem', 'status'] as const

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  data: 110,
  descricao: 280,
  categoria: 150,
  subcategoria: 150,
  valor: 120,
  origem: 100,
  status: 140,
}

interface TxRow {
  id: string
  occurred_on: string
  description: string
  amount: number
  kind: 'expense' | 'income'
  category_id: string | null
  status: 'pending_review' | 'confirmed'
  source: 'manual' | 'bank'
}

function fmtDate(iso: string): string {
  // YYYY-MM-DD → DD-MM-YYYY
  return iso.slice(0, 10).split('-').reverse().join('-')
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"'
  }
  return val
}

interface ModalState {
  open: boolean
  mode: 'create' | 'edit'
  id: string
  description: string
  amount: string
  occurred_on: string
  kind: 'expense' | 'income'
  saving: boolean
  error: string | null
}

const EMPTY_MODAL: ModalState = {
  open: false,
  mode: 'create',
  id: '',
  description: '',
  amount: '',
  occurred_on: new Date().toISOString().slice(0, 10),
  kind: 'expense',
  saving: false,
  error: null,
}

export default function Transacoes() {
  const [categories, setCategories] = useState<Category[]>([])
  const [txs, setTxs] = useState<TxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Filters
  const [period, setPeriod] = useState<PeriodKey | 'custom'>('this_month')
  const [customFrom, setCustomFrom] = useState<string>(() => new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA'))
  const [customTo, setCustomTo] = useState<string>(() => new Date().toLocaleDateString('en-CA'))
  const [kindFilter, setKindFilter] = useState<'all' | 'expense' | 'income'>('all')
  const [catFilter, setCatFilter] = useState<string>('')
  const [subCatFilter, setSubCatFilter] = useState<string>('todas')
  const [search, setSearch] = useState('')

  // Sincronização com o banco (Open Finance): volta na Fase 3.

  // Modal
  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL)

  // Larguras de coluna ajustáveis (persistidas no navegador)
  const { widths, startResize, reset: resetWidths } = useColumnWidths(DEFAULT_COL_WIDTHS, 'tx-col-widths')
  const tableWidth = 40 /* checkbox */ + TX_COLS.reduce((s, k) => s + (widths[k] ?? 0), 0) + 90 /* ações */

  // Change 2: Categoria + Subcategoria state for the modal
  const [formCategoria, setFormCategoria] = useState<string>('')
  const [formSubcategoria, setFormSubcategoria] = useState<string>('')

  // Seleção múltipla
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Modal de reclassificação em massa
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkCategoria, setBulkCategoria] = useState<string>('')
  const [bulkSubcategoria, setBulkSubcategoria] = useState<string>('')

  // Derived: root categories and subcategories for the selected root
  const rootCategories = useMemo(
    () => categories.filter((c) => c.parent_id === null),
    [categories],
  )
  const subCategories = useMemo(
    () => categories.filter((c) => c.parent_id === formCategoria),
    [categories, formCategoria],
  )

  // Subcategorias da Categoria escolhida na reclassificação em massa
  const bulkSubCategories = useMemo(
    () => categories.filter((c) => c.parent_id === bulkCategoria),
    [categories, bulkCategoria],
  )

  // Todas as subcategorias agrupadas pela categoria-raiz — o filtro de Subcategoria
  // funciona de forma INDEPENDENTE (não precisa escolher a Categoria antes).
  const subcategoryGroups = useMemo(() => {
    const roots = categories.filter((c) => !c.parent_id)
    return roots
      .map((root) => ({ root, subs: categories.filter((c) => c.parent_id === root.id) }))
      .filter((g) => g.subs.length > 0)
  }, [categories])

  // Change 3: build category lookup map
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  function catRoot(catId: string | null): string {
    if (!catId) return '—'
    const cat = catById.get(catId)
    if (!cat) return '—'
    if (cat.parent_id) {
      const parent = catById.get(cat.parent_id)
      return parent ? parent.name : '—'
    }
    return cat.name
  }

  function catSub(catId: string | null): string {
    if (!catId) return '—'
    const cat = catById.get(catId)
    if (!cat) return '—'
    if (cat.parent_id) return cat.name
    return '—'
  }

  // Keep pathOf for the CSV export (retains full path as before)
  const pathOf = useMemo(() => {
    return (catId: string | null): string => {
      if (!catId) return '—'
      const cat = catById.get(catId)
      if (!cat) return '—'
      if (cat.parent_id) {
        const parent = catById.get(cat.parent_id)
        if (parent) return `${parent.name} > ${cat.name}`
      }
      return cat.name
    }
  }, [catById])

  async function loadCategories() {
    const { data } = await supabase
      .from('categories')
      .select('id, name, parent_id, monthly_target')
      .order('name')
    if (data) setCategories(data as Category[])
  }

  // Effective range: real period via periodRange, or the custom date inputs.
  const range = useMemo(
    () => (period === 'custom' ? { from: customFrom, to: customTo } : periodRange(period as PeriodKey)),
    [period, customFrom, customTo],
  )

  async function loadTxs(from: string, to: string) {
    setLoading(true)
    setLoadError(null)
    const { rows, error } = await fetchAllPages<TxRow>((pFrom, pTo) =>
      supabase
        .from('transactions')
        .select('id, occurred_on, description, amount, kind, category_id, status, source')
        .gte('occurred_on', from)
        .lte('occurred_on', to)
        .order('occurred_on', { ascending: false })
        .order('id', { ascending: true }) // desempate: paginação estável
        .range(pFrom, pTo),
    )
    if (error) {
      setLoadError(error)
      setLoading(false)
      return
    }
    setTxs(rows)
    setLoading(false)
  }

  useEffect(() => {
    loadCategories()
  }, [])

  useEffect(() => {
    loadTxs(range.from, range.to)
  }, [range.from, range.to])

  // Client-side filtering
  const filtered = useMemo(() => {
    return txs.filter((t) => {
      if (kindFilter !== 'all' && t.kind !== kindFilter) return false
      // Categoria (raiz): casa a própria raiz E todas as suas subcategorias.
      if (catFilter !== '') {
        const cat = t.category_id ? catById.get(t.category_id) : undefined
        const matchesRoot = t.category_id === catFilter || cat?.parent_id === catFilter
        if (!matchesRoot) return false
      }
      // Subcategoria: filtro independente — casa exatamente a subcategoria escolhida.
      if (subCatFilter !== 'todas' && t.category_id !== subCatFilter) return false
      if (search.trim() !== '' && !t.description.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [txs, kindFilter, catFilter, subCatFilter, search, catById])

  // Paginação SÓ da renderização (decisão da F9): totais, seleção em lote e
  // export continuam sobre o filtro inteiro.
  const TX_PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / TX_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * TX_PAGE_SIZE, safePage * TX_PAGE_SIZE)

  // Filtro/período mudou → volta à página 1.
  useEffect(() => {
    setPage(1)
  }, [kindFilter, catFilter, subCatFilter, search, range.from, range.to])

  // Mantém a seleção restrita às linhas visíveis: sempre que os filtros (ou o período)
  // mudam, remove da seleção qualquer id que não esteja mais em `filtered`, evitando
  // que uma ação em massa atinja linhas ocultas.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(filtered.map((t) => t.id))
      const next = new Set<string>()
      for (const id of prev) if (visible.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  // Seleção: alterna um id
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Seleção: marca/desmarca todas as linhas filtradas
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))
  function toggleAll() {
    setSelected(() => (allSelected ? new Set() : new Set(filtered.map((t) => t.id))))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // Summary
  const totalIncome = useMemo(() => filtered.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])

  // Export CSV
  function handleExportCsv() {
    const BOM = '﻿'
    const header = 'data,descrição,categoria,valor,tipo,status'
    const rows = filtered.map((t) => {
      const cols = [
        fmtDate(t.occurred_on),
        t.description,
        pathOf(t.category_id),
        String(t.amount),
        t.kind === 'expense' ? 'despesa' : 'receita',
        t.status === 'confirmed' ? 'confirmado' : 'pendente',
      ]
      return cols.map(csvEscape).join(',')
    })
    const csv = BOM + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'transacoes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Modal helpers
  function openCreate() {
    setFormCategoria('')
    setFormSubcategoria('')
    setModal({
      ...EMPTY_MODAL,
      open: true,
      mode: 'create',
      occurred_on: new Date().toISOString().slice(0, 10),
    })
  }

  function openEdit(t: TxRow) {
    // Change 2: prefill categoria/subcategoria from category_id
    if (t.category_id) {
      const cat = catById.get(t.category_id)
      if (cat && cat.parent_id) {
        setFormCategoria(cat.parent_id)
        setFormSubcategoria(t.category_id)
      } else {
        setFormCategoria(t.category_id)
        setFormSubcategoria('')
      }
    } else {
      setFormCategoria('')
      setFormSubcategoria('')
    }
    setModal({
      open: true,
      mode: 'edit',
      id: t.id,
      description: t.description,
      amount: String(t.amount),
      occurred_on: t.occurred_on.slice(0, 10),
      kind: t.kind,
      saving: false,
      error: null,
    })
  }

  function closeModal() {
    setModal(EMPTY_MODAL)
    setFormCategoria('')
    setFormSubcategoria('')
  }

  async function handleSave() {
    if (!modal.description.trim() || !modal.amount) {
      setModal((m) => ({ ...m, error: 'Preencha descrição e valor.' }))
      return
    }
    setModal((m) => ({ ...m, saving: true, error: null }))
    // Change 2: resolve category_id from sub/root
    const resolvedCategoryId = formSubcategoria || formCategoria || null
    const payload = {
      description: modal.description.trim(),
      amount: parseFloat(modal.amount),
      occurred_on: modal.occurred_on,
      kind: modal.kind,
      category_id: resolvedCategoryId,
      // Com categoria, a transação fica confirmada — assim sai da revisão diária do bot.
      // (Antes, editar atualizava só a categoria e deixava status='pending_review',
      // então a transação voltava no Telegram todo dia.)
      status: resolvedCategoryId ? 'confirmed' : 'pending_review',
    }

    if (modal.mode === 'edit') {
      const { error } = await supabase.from('transactions').update(payload).eq('id', modal.id)
      if (error) { setModal((m) => ({ ...m, saving: false, error: error.message })); return }
      // Aprende com a reclassificação: só quando uma categoria foi escolhida e mudou.
      const original = txs.find((t) => t.id === modal.id)?.category_id ?? null
      if (resolvedCategoryId && resolvedCategoryId !== original) {
        upsertRule(payload.description, resolvedCategoryId).catch(() => {})
      }
    } else {
      const { error } = await supabase.from('transactions').insert({
        ...payload,
        source: 'manual',
      })
      if (error) { setModal((m) => ({ ...m, saving: false, error: error.message })); return }
    }

    closeModal()
    await loadTxs(range.from, range.to)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Excluir esta transação?')) return
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { alert(error.message); return }
    await loadTxs(range.from, range.to)
  }

  // Reclassificação em massa
  function openBulkReclassify() {
    setBulkCategoria('')
    setBulkSubcategoria('')
    setBulkOpen(true)
  }

  function closeBulkReclassify() {
    setBulkOpen(false)
    setBulkCategoria('')
    setBulkSubcategoria('')
  }

  async function handleBulkReclassify() {
    const categoryId = bulkSubcategoria || bulkCategoria
    if (!categoryId) return
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkSaving(true)
    const { error } = await supabase
      .from('transactions')
      .update({ category_id: categoryId, status: 'confirmed' })
      .in('id', ids)
    if (error) { alert(error.message); setBulkSaving(false); return }
    // Aprende com a reclassificação (fire-and-forget; a lógica de ambiguidade em upsertRule trata conflitos).
    const byId = new Map(txs.map((t) => [t.id, t]))
    for (const id of ids) {
      const tx = byId.get(id)
      if (tx) upsertRule(tx.description, categoryId).catch(() => {})
    }
    await loadTxs(range.from, range.to)
    clearSelection()
    setBulkSaving(false)
    closeBulkReclassify()
  }

  // Exclusão em massa
  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(`Excluir ${ids.length} transação${ids.length !== 1 ? 'ões' : ''}? Esta ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) { alert(error.message); return }
    await loadTxs(range.from, range.to)
    clearSelection()
  }

  // Confirmar em massa — marca como confirmado MANTENDO a categoria de cada linha
  // (ao contrário do "Reclassificar", que força todas para a mesma categoria).
  async function handleBulkConfirm() {
    const ids = [...selected]
    if (ids.length === 0) return
    const { error } = await supabase
      .from('transactions')
      .update({ status: 'confirmed' })
      .in('id', ids)
    if (error) { alert(error.message); return }
    await loadTxs(range.from, range.to)
    clearSelection()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Transações</h1>
          <p className="text-sm text-muted mt-0.5">
            {filtered.length} transação{filtered.length !== 1 ? 'ões' : ''} &nbsp;·&nbsp;
            <span className="text-accent-soft-ink">+{formatBrl(totalIncome)}</span>
            {' '}receitas&nbsp;&nbsp;
            <span className="text-red-500">−{formatBrl(totalExpense)}</span>
            {' '}despesas
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Botão de sincronização com o banco (Open Finance) volta na Fase 3. */}
          <button onClick={handleExportCsv} className="btn-ghost">
            Exportar CSV
          </button>
          <button onClick={openCreate} className="btn-primary">
            + Nova transação
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted uppercase tracking-wide">Período</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey | 'custom')}
            className="input w-44"
          >
            {(Object.entries(PERIOD_LABELS) as [PeriodKey, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">De</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Até</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input w-40"
              />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted uppercase tracking-wide">Tipo</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            className="input w-36"
          >
            <option value="all">Todos</option>
            <option value="expense">Despesas</option>
            <option value="income">Receitas</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted uppercase tracking-wide">Categoria</label>
          <select
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value)
              setSubCatFilter('todas')
            }}
            className="input w-44"
          >
            <option value="">Todas</option>
            {categories.filter((c) => !c.parent_id).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted uppercase tracking-wide">Subcategoria</label>
          <select
            value={subCatFilter}
            onChange={(e) => setSubCatFilter(e.target.value)}
            disabled={subcategoryGroups.length === 0}
            className="input w-56"
          >
            <option value="todas">Todas as subcategorias</option>
            {subcategoryGroups.map((g) => (
              <optgroup key={g.root.id} label={g.root.name}>
                {g.subs.map((sub) => (
                  <option key={sub.id} value={sub.id}>{sub.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 w-64">
          <label className="text-xs font-medium text-muted uppercase tracking-wide">Busca</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar descrição…"
            className="input"
          />
        </div>
      </div>

      {/* Barra de ações em massa */}
      {selected.size > 0 && (
        <div className="bg-accent-soft text-accent-soft-ink rounded-xl px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selected.size} selecionada{selected.size !== 1 ? 's' : ''}
          </span>
          <button onClick={handleBulkConfirm} className="btn-primary">
            Confirmar
          </button>
          <button onClick={openBulkReclassify} className="btn-ghost">
            Reclassificar
          </button>
          <button onClick={handleBulkDelete} className="btn-ghost">
            Excluir
          </button>
          <button onClick={clearSelection} className="btn-ghost">
            Limpar seleção
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card animate-pulse">
          <div className="h-4 bg-surface-2 rounded w-1/3 mb-3" />
          <div className="h-4 bg-surface-2 rounded w-2/3 mb-3" />
          <div className="h-4 bg-surface-2 rounded w-1/2" />
        </div>
      )}

      {/* Error */}
      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {loadError}
        </div>
      )}

      {/* Reset de larguras das colunas */}
      {!loading && !loadError && filtered.length > 0 && (
        <div className="flex justify-end -mb-3">
          <button
            onClick={resetWidths}
            className="text-xs text-muted hover:text-ink"
            title="Voltar as colunas para a largura padrão"
          >
            Redefinir larguras
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && !loadError && (
        <div className="card p-0 overflow-x-auto">
          {filtered.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted text-center">Nenhuma transação encontrada.</p>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: tableWidth }}>
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas"
                      className="h-4 w-4 cursor-pointer align-middle"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.size > 0 && !allSelected
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                  <ResizableHeader width={widths.data} onResizeStart={(e) => startResize('data', e)}>Data</ResizableHeader>
                  <ResizableHeader width={widths.descricao} onResizeStart={(e) => startResize('descricao', e)}>Descrição</ResizableHeader>
                  <ResizableHeader width={widths.categoria} onResizeStart={(e) => startResize('categoria', e)}>Categoria</ResizableHeader>
                  <ResizableHeader width={widths.subcategoria} onResizeStart={(e) => startResize('subcategoria', e)}>Subcategoria</ResizableHeader>
                  <ResizableHeader width={widths.valor} onResizeStart={(e) => startResize('valor', e)}>Valor</ResizableHeader>
                  <ResizableHeader width={widths.origem} onResizeStart={(e) => startResize('origem', e)}>Origem</ResizableHeader>
                  <ResizableHeader width={widths.status} onResizeStart={(e) => startResize('status', e)}>Status</ResizableHeader>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-hairline last:border-0 hover:bg-surface-2 transition-colors"
                  >
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Selecionar transação"
                        className="h-4 w-4 cursor-pointer align-middle"
                        checked={selected.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted tabular-nums overflow-hidden">
                      {fmtDate(t.occurred_on)}
                    </td>
                    <td className="px-4 py-3 overflow-hidden">
                      <span className="truncate block text-ink" title={t.description}>{t.description}</span>
                    </td>
                    {/* Change 3: Categoria (root) */}
                    <td className="px-4 py-3 text-muted overflow-hidden">
                      <span className="truncate block" title={catRoot(t.category_id)}>{catRoot(t.category_id)}</span>
                    </td>
                    {/* Change 3: Subcategoria */}
                    <td className="px-4 py-3 text-muted overflow-hidden">
                      <span className="truncate block" title={catSub(t.category_id)}>{catSub(t.category_id)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums font-medium">
                      {t.kind === 'expense' ? (
                        <span className="text-red-500">−{formatBrl(Number(t.amount))}</span>
                      ) : (
                        <span className="text-accent-soft-ink">+{formatBrl(Number(t.amount))}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {t.source === 'bank' ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-accent-soft text-accent-soft-ink">
                          banco
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-surface-2 text-muted">
                          manual
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {t.status === 'confirmed' ? (
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <span className="dot-ok" />
                          Confirmado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-600">
                          <span className="dot-pending" />
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(t)}
                          aria-label="Editar"
                          title="Editar"
                          className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2 transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          aria-label="Excluir"
                          title="Excluir"
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && !loadError && filtered.length > TX_PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4">
          <button
            className="btn-ghost"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Anterior
          </button>
          <span className="text-sm text-muted tabular-nums">
            {(safePage - 1) * TX_PAGE_SIZE + 1}–{Math.min(safePage * TX_PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          <button
            className="btn-ghost"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Próxima ›
          </button>
        </div>
      )}

      {/* Modal de sincronização com o banco (Open Finance) volta na Fase 3. */}

      {/* Reclassificação em massa */}
      {bulkOpen && (
        <Modal
          title={`Reclassificar ${selected.size} transação${selected.size !== 1 ? 'ões' : ''}`}
          onClose={closeBulkReclassify}
          footer={
            <>
              <button onClick={closeBulkReclassify} className="btn-ghost" disabled={bulkSaving}>
                Cancelar
              </button>
              <button
                onClick={handleBulkReclassify}
                disabled={bulkSaving || !(bulkSubcategoria || bulkCategoria)}
                className="btn-primary"
              >
                {bulkSaving ? 'Aplicando…' : 'Aplicar'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">Categoria</label>
            <select
              value={bulkCategoria}
              onChange={(e) => {
                setBulkCategoria(e.target.value)
                setBulkSubcategoria('')
              }}
              className="input"
            >
              <option value="">—</option>
              {rootCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted uppercase tracking-wide">Subcategoria</label>
            <select
              value={bulkSubcategoria}
              onChange={(e) => setBulkSubcategoria(e.target.value)}
              disabled={!bulkCategoria}
              className="input"
            >
              <option value="">— (opcional)</option>
              {bulkSubCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {/* Transaction add/edit Modal */}
      {modal.open && (
        <div
          className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="card max-w-md w-full flex flex-col gap-5">
            <h2 className="text-base font-semibold text-ink">
              {modal.mode === 'create' ? 'Nova transação' : 'Editar transação'}
            </h2>

            <div className="flex flex-col gap-4">
              {/* Descrição */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">Descrição</label>
                <input
                  type="text"
                  value={modal.description}
                  onChange={(e) => setModal((m) => ({ ...m, description: e.target.value }))}
                  placeholder="ex.: Mercado"
                  className="input"
                />
              </div>

              {/* Valor + Tipo */}
              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-medium text-muted uppercase tracking-wide">Valor (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={modal.amount}
                    onChange={(e) => setModal((m) => ({ ...m, amount: e.target.value }))}
                    placeholder="0,00"
                    className="input"
                  />
                </div>
                <div className="flex flex-col gap-1 w-36">
                  <label className="text-xs font-medium text-muted uppercase tracking-wide">Tipo</label>
                  <select
                    value={modal.kind}
                    onChange={(e) => setModal((m) => ({ ...m, kind: e.target.value as 'expense' | 'income' }))}
                    className="input"
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </div>
              </div>

              {/* Data */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">Data</label>
                <input
                  type="date"
                  value={modal.occurred_on}
                  onChange={(e) => setModal((m) => ({ ...m, occurred_on: e.target.value }))}
                  className="input"
                />
              </div>

              {/* Change 2: Categoria (root) */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">Categoria</label>
                <select
                  value={formCategoria}
                  onChange={(e) => {
                    setFormCategoria(e.target.value)
                    setFormSubcategoria('')
                  }}
                  className="input"
                >
                  <option value="">—</option>
                  {rootCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Change 2: Subcategoria */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">Subcategoria</label>
                <select
                  value={formSubcategoria}
                  onChange={(e) => setFormSubcategoria(e.target.value)}
                  disabled={!formCategoria}
                  className="input"
                >
                  <option value="">— (opcional)</option>
                  {subCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {modal.error && (
              <p className="text-sm text-red-600">{modal.error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={closeModal} className="btn-ghost">Cancelar</button>
              <button onClick={handleSave} disabled={modal.saving} className="btn-primary">
                {modal.saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
