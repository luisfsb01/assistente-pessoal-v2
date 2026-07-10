export interface Category {
  id: string
  name: string
  parent_id: string | null
  monthly_target: number | null
  counts: boolean
  type: 'income' | 'expense' | 'investment'
}

/**
 * Meta efetiva de uma categoria. Se a categoria tem filhas, retorna a SOMA das
 * metas das filhas (apenas as numéricas); se há filhas mas nenhuma tem meta,
 * retorna null. Sem filhas → a própria meta da categoria.
 */
export function effectiveTarget(catId: string, categories: Category[]): number | null {
  const children = categories.filter((c) => c.parent_id === catId)
  if (children.length > 0) {
    const targets = children.map((c) => c.monthly_target).filter((t): t is number => t != null)
    if (targets.length === 0) return null
    return targets.reduce((s, t) => s + t, 0)
  }
  const self = categories.find((c) => c.id === catId)
  return self?.monthly_target ?? null
}

/**
 * Uma categoria conta nos totais? true se o id for null/desconhecido OU se nem a
 * própria categoria nem nenhum ancestral (até a raiz) tiver counts === false.
 */
export function isCounted(categoryId: string | null, categories: Category[]): boolean {
  if (categoryId == null) return true
  const byId = new Map(categories.map((c) => [c.id, c]))
  let cur = byId.get(categoryId) ?? null
  if (!cur) return true
  let guard = 0
  while (cur && guard++ < 10) {
    if (cur.counts === false) return false
    if (!cur.parent_id) break
    cur = byId.get(cur.parent_id) ?? null
  }
  return true
}

/** true se a categoria RAIZ do id for do tipo investment. */
export function isInvestment(categoryId: string | null, categories: Category[]): boolean {
  if (categoryId == null) return false
  const byId = new Map(categories.map((c) => [c.id, c]))
  let cur = byId.get(categoryId) ?? null
  let guard = 0
  while (cur?.parent_id && guard++ < 10) {
    cur = byId.get(cur.parent_id) ?? null
  }
  return cur?.type === 'investment'
}

export interface Tx {
  id: string
  occurred_on: string
  description: string
  amount: number
  kind: 'expense' | 'income'
  category_id: string | null
  status: 'pending_review' | 'confirmed'
  category_name: string | null
}

export interface Kpis {
  income: number
  expense: number
  invested: number
  balance: number
}

export function kpis(txs: Tx[], categories: Category[]): Kpis {
  let income = 0
  let expense = 0
  let invested = 0
  for (const t of txs) {
    const amount = Number(t.amount)
    if (isInvestment(t.category_id, categories)) {
      invested += t.kind === 'expense' ? amount : -amount
    } else if (t.kind === 'income') {
      income += amount
    } else {
      expense += amount
    }
  }
  return { income, expense, invested, balance: income - expense - invested }
}

/** Variação percentual arredondada de previous→current. previous 0 → 0. */
export function variation(current: number, previous: number): number {
  if (previous === 0) return 0
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

export interface MonthFlow {
  month: number // 0-11
  income: number
  expense: number
  invested: number
}

/** 12 meses do ano dado, separando receita/despesa/investido por mês (occurred_on YYYY-MM-DD). */
export function monthlyCashflow(txs: Tx[], year: number, categories: Category[]): MonthFlow[] {
  const out: MonthFlow[] = Array.from({ length: 12 }, (_, month) => ({ month, income: 0, expense: 0, invested: 0 }))
  for (const t of txs) {
    const [yStr, mStr] = t.occurred_on.split('-')
    if (Number(yStr) !== year) continue
    const idx = Number(mStr) - 1
    if (idx < 0 || idx > 11) continue
    const amount = Number(t.amount)
    if (isInvestment(t.category_id, categories)) {
      out[idx].invested += t.kind === 'expense' ? amount : -amount
    } else if (t.kind === 'income') {
      out[idx].income += amount
    } else {
      out[idx].expense += amount
    }
  }
  return out
}

export interface CategorySpend {
  name: string
  total: number
  monthlyTarget: number | null
}

/** Despesas agrupadas pela categoria RAIZ (resolve parent_id), ordenadas desc. */
export function spendingByRootCategory(txs: Tx[], categories: Category[]): CategorySpend[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rootOf = (id: string | null): Category | null => {
    let cur = id ? byId.get(id) ?? null : null
    let guard = 0
    while (cur?.parent_id && guard++ < 10) {
      const parent = byId.get(cur.parent_id)
      if (!parent) break
      cur = parent
    }
    return cur
  }
  const totals = new Map<string, number>()
  for (const t of txs) {
    if (t.kind !== 'expense') continue
    if (!isCounted(t.category_id, categories)) continue
    if (isInvestment(t.category_id, categories)) continue
    const root = rootOf(t.category_id)
    const name = root?.name ?? 'Sem categoria'
    totals.set(name, (totals.get(name) ?? 0) + Number(t.amount))
  }
  const targetByName = new Map(
    categories.filter((c) => !c.parent_id).map((c) => [c.name, effectiveTarget(c.id, categories)]),
  )
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total, monthlyTarget: targetByName.get(name) ?? null }))
    .sort((a, b) => b.total - a.total)
}

export interface SubcategorySpend { name: string; total: number }

/** Top N subcategorias (parent_id != null) por gasto. Nome = "Pai > Filho". */
export function topSubcategories(txs: Tx[], categories: Category[], n = 5): SubcategorySpend[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, number>()
  for (const t of txs) {
    if (t.kind !== 'expense' || !t.category_id) continue
    if (!isCounted(t.category_id, categories)) continue
    if (isInvestment(t.category_id, categories)) continue
    const cat = byId.get(t.category_id)
    if (!cat || !cat.parent_id) continue // só subcategorias
    const parent = byId.get(cat.parent_id)
    const name = parent ? `${parent.name} > ${cat.name}` : cat.name
    totals.set(name, (totals.get(name) ?? 0) + Number(t.amount))
  }
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
}

/** Top N subcategorias (gasto) cujo pai (raiz) é `rootName`. Nome = só o nome da subcategoria. */
export function subcategoriesOfRoot(txs: Tx[], categories: Category[], rootName: string, n = 5): SubcategorySpend[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, number>()
  for (const t of txs) {
    if (t.kind !== 'expense' || !t.category_id) continue
    if (!isCounted(t.category_id, categories)) continue
    if (isInvestment(t.category_id, categories)) continue
    const cat = byId.get(t.category_id)
    if (!cat || !cat.parent_id) continue
    const parent = byId.get(cat.parent_id)
    if (!parent || parent.name !== rootName) continue
    totals.set(cat.name, (totals.get(cat.name) ?? 0) + Number(t.amount))
  }
  return [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, n)
}

export interface MonthFlowAcc extends MonthFlow { balanceAcc: number }

/** Acrescenta o saldo acumulado (running sum de income-expense-invested) mês a mês. */
export function withAccumulatedBalance(flow: MonthFlow[]): MonthFlowAcc[] {
  let acc = 0
  return flow.map((f) => {
    acc += f.income - f.expense - f.invested
    return { ...f, balanceAcc: acc }
  })
}
