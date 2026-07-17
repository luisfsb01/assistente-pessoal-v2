# Fase 9 — Dashboard financeiro: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard financeiro correto com qualquer volume (agregação anual em SQL, fetch paginado que nunca trunca), Transações paginada, zero `alert()`/`confirm()` no app e ajustes de mobile.

**Architecture:** Migração 0008 cria `monthly_cashflow(p_year)` (CTE recursiva espelhando a lógica de `finance-data.ts`); o Dashboard troca o download do ano inteiro por esse agregado (12 linhas). Um helper puro `fetchAllPages` pagina as queries de transações em janelas de 1000 (o PostgREST corta em 1000 por padrão). A página de Transações pagina só a RENDERIZAÇÃO (50/página) — totais, seleção em lote e export continuam sobre o filtro inteiro (decisão assinada no brainstorm). Modais substituem alert/confirm em Transações/Categorias/Objetivos usando o `Modal` existente.

**Tech Stack:** React 19 + Vite + Tailwind 4 (apps/web), Supabase PostgREST + RPC, vitest (raiz).

**Spec:** `docs/superpowers/specs/2026-07-17-fase9-dashboard-design.md`

## Global Constraints

- Web (apps/web): sem ponto e vírgula no fim de linha, aspas simples; strings PT-BR; datas dd/mm; nunca UUIDs ao usuário.
- UI: classes utilitárias (`card`, `input`, `btn-primary`, `btn-ghost`), `Modal` named export de `../components/Modal` (props `{ title, onClose, children, footer? }`), tokens de tema (`text-ink`, `text-muted`, `bg-surface-2`, `border-hairline`); ao final da fase NENHUM `alert(`/`confirm(` sobra em `apps/web/src`.
- Migração `supabase/migrations/0008_fase9.sql` NÃO é aplicada em produção durante a implementação — aplica-se no deploy da fase (SETUP.md, Task 6). Até lá o gráfico anual mostra o erro da RPC inexistente em dev — esperado e aceitável.
- Toda query paginada de transações ganha ordenação secundária `.order('id', { ascending: true })` — sem desempate, linhas com a mesma data podem trocar de página entre janelas.
- Testes: `npx vitest run <caminho>` da raiz. A Task 2 muda o `vitest.config.ts` para incluir `apps/web/src/lib/**/*.test.ts` (lógica pura, sem DOM). Páginas/hooks continuam sem teste de UI (backlog conhecido).
- Validação de página web: `npm run web:build` (tsc -b + vite build) tem que passar limpo.
- Commits: um por task, `feat(f9): ...` / `fix(f9): ...`.

### Interfaces existentes que a fase consome (verbatim do código atual)

- `apps/web/src/lib/finance-data.ts`: `type Tx`, `type Category`, `type MonthFlow = { month: number /*0-11*/; income: number; expense: number; invested: number }`, `kpis(txs, categories)`, `variation(current, previous)`, `monthlyCashflow(txs, year, categories)`, `withAccumulatedBalance(flow): MonthFlowAcc[]`, `spendingByRootCategory`, `topSubcategories`, `subcategoriesOfRoot`, `isCounted(categoryId, categories)`.
- `apps/web/src/lib/useFinance.ts`: `useFinance(range: Range): { txs, categories, loading, error }` — busca transações do range + categorias (query em `useFinance.ts:23-31`).
- `apps/web/src/lib/period.ts`: `periodRange(key)`, `previousRange(key)`, `yearRange()`, `type Range = { from: string; to: string }`.
- `apps/web/src/pages/Dashboard.tsx`: usa `useFinance(range)`, `useFinance(prev)` e `useFinance(yearRange())` (linhas 18-20); KPI "Saldo no ano" = `yearKpis.balance` (linha 88); gráfico anual em `IncomeExpenseChart data={withAccumulatedBalance(monthlyCashflow(countedYear, ano, cats))}` (linha 102).
- `apps/web/src/pages/Transacoes.tsx` (899 linhas): `loadTxs(from, to)` (linhas 184-200); `filtered` (useMemo, linhas 211-225); seleção `selected: Set<string>` restrita a `filtered` (efeito 230-238); `allSelected`/`toggleAll` (251-254); totais (261-262); export CSV sobre `filtered` (265-287); `handleDelete` com confirm/alert (375-380); `handleBulkReclassify` alert (405); `handleBulkDelete` confirm/alert (419-427); `handleBulkConfirm` alert (438); tbody renderiza `filtered.map` (linha 645); contagem no header usa `filtered.length` (450).
- `apps/web/src/pages/Categorias.tsx`: `handleDelete(id, name)` com confirm/alert (linhas ~271-287; detecção de FK `23503`).
- `apps/web/src/pages/Objetivos.tsx`: `handleDelete(goal)` com confirm/alert (linhas 76-84); `deleteGoal(goal.id)` + `reload()` já existem.
- `apps/web/src/components/Modal.tsx`: named export `Modal({ title, onClose, children, footer? })`.
- `vitest.config.ts` (raiz): `test: { include: ['apps/server/src/**/*.test.ts'] }`.
- `apps/web/src/lib/finance-data.test.ts`: JÁ EXISTE (nunca rodou — runner não incluía o web).
- Gráficos já responsivos (`ResponsiveContainer width="100%"`); barras horizontais com `YAxis width={150}` (TopSubcategoriesChart.tsx:50) e `width={90}` (CategoryVsTargetChart.tsx:62).
- `components/Layout.tsx:170`: main com `px-6 lg:px-10`.

---

### Task 1: Migração 0008 + `useYearCashflow` + Dashboard sem download do ano

**Files:**
- Create: `supabase/migrations/0008_fase9.sql`
- Create: `apps/web/src/lib/useYearCashflow.ts`
- Modify: `apps/web/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `MonthFlow`, `withAccumulatedBalance`, `supabase`.
- Produces: RPC `monthly_cashflow(p_year int)` → 12 linhas `(month 1-12, income, expense, invested)`; hook `useYearCashflow(year: number): { flow: MonthFlow[]; loading: boolean; error: string | null }` (month convertido para 0-11).

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0008_fase9.sql`:

```sql
-- Fase 9: agregação anual do dashboard no banco.
-- Corrige o corte de 1000 linhas do PostgREST (o web baixava o ano inteiro de
-- transações e agregava em JS) e elimina esse download.
-- Espelha a lógica de apps/web/src/lib/finance-data.ts:
--   - raiz da árvore de categorias com type='investment' → conta como
--     investido (despesa soma, receita subtrai);
--   - counts=false na categoria OU em qualquer ancestral → fora dos totais;
--   - sem categoria (ou categoria desconhecida) → conta como income/expense.
-- security invoker (default): as policies de transactions/categories herdadas
-- da v1 já dão leitura às contas autenticadas do casal.
create or replace function monthly_cashflow(p_year int)
returns table (month int, income numeric, expense numeric, invested numeric)
language sql stable as $$
  with recursive cat_info as (
    select id, id as root_id, (counts = false) as excluded
    from categories
    where parent_id is null
    union all
    select c.id, ci.root_id, (ci.excluded or c.counts = false)
    from categories c
    join cat_info ci on c.parent_id = ci.id
  ),
  tx as (
    select t.amount,
           t.kind,
           extract(month from t.occurred_on)::int as m,
           coalesce(ci.excluded, false) as excluded,
           coalesce(r.type, '') = 'investment' as is_inv
    from transactions t
    left join cat_info ci on ci.id = t.category_id
    left join categories r on r.id = ci.root_id
    where extract(year from t.occurred_on)::int = p_year
  )
  select gs.m as month,
         coalesce(sum(t.amount) filter (where not t.excluded and not t.is_inv and t.kind = 'income'), 0) as income,
         coalesce(sum(t.amount) filter (where not t.excluded and not t.is_inv and t.kind = 'expense'), 0) as expense,
         coalesce(sum(case when t.kind = 'expense' then t.amount else -t.amount end)
                  filter (where not t.excluded and t.is_inv), 0) as invested
  from generate_series(1, 12) gs(m)
  left join tx t on t.m = gs.m
  group by gs.m
  order by gs.m;
$$;
```

- [ ] **Step 2: Criar o hook**

`apps/web/src/lib/useYearCashflow.ts`:

```tsx
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { MonthFlow } from './finance-data'

/**
 * Fluxo mensal do ano agregado NO BANCO (rpc monthly_cashflow, migração 0008).
 * Substitui o download do ano inteiro de transações no Dashboard.
 */
export function useYearCashflow(year: number): {
  flow: MonthFlow[]
  loading: boolean
  error: string | null
} {
  const [flow, setFlow] = useState<MonthFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase.rpc('monthly_cashflow', { p_year: year }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      const rows = (data ?? []) as Array<{ month: number; income: number; expense: number; invested: number }>
      setFlow(rows.map((r) => ({
        month: r.month - 1, // SQL devolve 1-12; MonthFlow usa 0-11
        income: Number(r.income),
        expense: Number(r.expense),
        invested: Number(r.invested),
      })))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [year])

  return { flow, loading, error }
}
```

- [ ] **Step 3: Religar o Dashboard**

Em `apps/web/src/pages/Dashboard.tsx`:

1. Imports: remover `yearRange` do import de `../lib/period`; remover `monthlyCashflow` do import de `../lib/finance-data`; adicionar `import { useYearCashflow } from '../lib/useYearCashflow'`.
2. Substituir `const yearData = useFinance(yearRange())` (linha 20) por:

```tsx
  const yearFlow = useYearCashflow(new Date().getFullYear())
  const yearBalance = yearFlow.flow.reduce((s, f) => s + f.income - f.expense - f.invested, 0)
```

3. Remover `const countedYear = ...` (linha 25) e `const yearKpis = kpis(countedYear, yearData.categories)` (linha 29).
4. No KPI "Saldo no ano" (linha 86-89): `value={yearBalance}`.
5. No bloco do gráfico anual (linhas 97-105), trocar por:

```tsx
          <div className="mt-5">
            {yearFlow.loading ? (
              <div className="card animate-pulse h-96" />
            ) : yearFlow.error ? (
              <div className="card text-red-600">{yearFlow.error}</div>
            ) : (
              <IncomeExpenseChart data={withAccumulatedBalance(yearFlow.flow)} />
            )}
          </div>
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK. (Em dev, o gráfico anual mostrará o erro da RPC até a 0008 ser aplicada em produção — esperado; o resto do Dashboard segue funcionando.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_fase9.sql apps/web/src/lib/useYearCashflow.ts apps/web/src/pages/Dashboard.tsx
git commit -m "feat(f9): agregação anual no banco (monthly_cashflow) — dashboard sem baixar o ano inteiro"
```

---

### Task 2: `fetchAllPages` (TDD) + vitest inclui web lib + fetch em loop no `useFinance` e em Transações

**Files:**
- Modify: `vitest.config.ts`
- Create: `apps/web/src/lib/fetch-all-pages.ts`
- Create: `apps/web/src/lib/fetch-all-pages.test.ts`
- Modify: `apps/web/src/lib/useFinance.ts` (fetch de transações)
- Modify: `apps/web/src/pages/Transacoes.tsx:184-200` (`loadTxs`)

**Interfaces:**
- Produces: `fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }>` e `PAGE_SIZE = 1000`.

- [ ] **Step 1: Incluir a lib do web no runner**

`vitest.config.ts` (raiz) — trocar o include:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/server/src/**/*.test.ts',
      'apps/web/src/lib/**/*.test.ts', // lógica pura do web (sem DOM)
    ],
  },
});
```

- [ ] **Step 2: Confirmar que o teste órfão passa**

Run: `npx vitest run apps/web/src/lib/finance-data.test.ts`
Expected: PASS (o arquivo existe desde a F1.5 mas nunca rodou). Se falhar, investigar a divergência entre teste e `finance-data.ts` (a lógica não mudou desde o porte) e corrigir minimamente, relatando como concern.

- [ ] **Step 3: Escrever o teste do helper (falhando)**

`apps/web/src/lib/fetch-all-pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fetchAllPages, PAGE_SIZE } from './fetch-all-pages'

function page(n: number, start = 0): number[] {
  return Array.from({ length: n }, (_, i) => start + i)
}

describe('fetchAllPages', () => {
  it('página única curta: uma chamada, retorna as linhas', async () => {
    const calls: Array<[number, number]> = []
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to])
      return { data: page(3), error: null }
    })
    expect(result).toEqual({ rows: page(3), error: null })
    expect(calls).toEqual([[0, PAGE_SIZE - 1]])
  })

  it('concatena páginas cheias até vir página curta, com janelas certas', async () => {
    const pages = [page(PAGE_SIZE, 0), page(PAGE_SIZE, PAGE_SIZE), page(10, 2 * PAGE_SIZE)]
    const calls: Array<[number, number]> = []
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to])
      return { data: pages[calls.length - 1], error: null }
    })
    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(2 * PAGE_SIZE + 10)
    expect(result.rows[0]).toBe(0)
    expect(result.rows.at(-1)).toBe(2 * PAGE_SIZE + 9)
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ])
  })

  it('erro em qualquer página interrompe e propaga a mensagem', async () => {
    let n = 0
    const result = await fetchAllPages<number>(async () => {
      n++
      if (n === 2) return { data: null, error: { message: 'boom' } }
      return { data: page(PAGE_SIZE), error: null }
    })
    expect(result).toEqual({ rows: [], error: 'boom' })
    expect(n).toBe(2)
  })

  it('data null sem erro conta como página vazia (curta)', async () => {
    const result = await fetchAllPages<number>(async () => ({ data: null, error: null }))
    expect(result).toEqual({ rows: [], error: null })
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run apps/web/src/lib/fetch-all-pages.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 5: Implementar**

`apps/web/src/lib/fetch-all-pages.ts`:

```ts
export const PAGE_SIZE = 1000

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Busca todas as páginas de uma query PostgREST — que corta em 1000 linhas por
 * padrão. Chama fetchPage(from, to) com janelas de PAGE_SIZE até vir página
 * curta. Retorna todas as linhas, ou o primeiro erro (com rows vazio).
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message }
    const pageRows = data ?? []
    rows.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) return { rows, error: null }
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run apps/web/src/lib/fetch-all-pages.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 7: Usar no `useFinance`**

Em `apps/web/src/lib/useFinance.ts`, adicionar `import { fetchAllPages } from './fetch-all-pages'` e trocar o fetch de transações (linhas 23-31). O bloco `Promise.all` vira:

```ts
      const [txRes, catRes] = await Promise.all([
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from('transactions')
            .select('id, occurred_on, description, amount, kind, category_id, status, categories(name)')
            .gte('occurred_on', range.from)
            .lte('occurred_on', range.to)
            .order('occurred_on', { ascending: false })
            .order('id', { ascending: true }) // desempate: paginação estável
            .range(from, to),
        ),
        supabase.from('categories').select('id, name, parent_id, monthly_target, type, counts'),
      ])

      if (cancelled) return

      if (txRes.error) {
        setError(txRes.error)
        setLoading(false)
        return
      }
```

e o mapeamento passa a ler de `txRes.rows` em vez de `txRes.data`:

```ts
      const mappedTxs: Tx[] = txRes.rows.map((row) => ({
```

(o corpo do map continua idêntico; ajustar o tipo do parâmetro se o TS reclamar — `row` era tipado por inferência do supabase; com `Record<string, unknown>` faça o cast pontual `const r = row as { id: string; occurred_on: string; description: string; amount: number; kind: string; category_id: string | null; status: string; categories: { name: string }[] | { name: string } | null }` no topo do map e leia de `r`).

- [ ] **Step 8: Usar no `loadTxs` de Transações**

Em `apps/web/src/pages/Transacoes.tsx` (linhas 184-200), adicionar `import { fetchAllPages } from '../lib/fetch-all-pages'` e trocar o corpo:

```tsx
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
```

- [ ] **Step 9: Suite + build**

Run: `npm test && npm run web:build`
Expected: suite PASS (server + web lib, incluindo finance-data e fetch-all-pages), build OK

- [ ] **Step 10: Commit**

```bash
git add vitest.config.ts apps/web/src/lib/fetch-all-pages.ts apps/web/src/lib/fetch-all-pages.test.ts apps/web/src/lib/useFinance.ts apps/web/src/pages/Transacoes.tsx
git commit -m "feat(f9): fetch paginado em loop (nunca trunca) + finance-data.test volta a rodar"
```

---

### Task 3: Paginação da renderização em Transações

**Files:**
- Modify: `apps/web/src/pages/Transacoes.tsx`

**Interfaces:**
- Consumes: `filtered` (useMemo linhas 211-225), tbody `filtered.map` (linha 645).
- Comportamento INALTERADO: totais (261-262), seleção/`toggleAll` (250-254), export CSV (265-287) e o efeito de restrição da seleção (230-238) continuam sobre `filtered` INTEIRO — só a tabela renderiza a página corrente.

- [ ] **Step 1: Estado e derivação da página**

Logo após o `const filtered = useMemo(...)` (linha 225), adicionar:

```tsx
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
```

- [ ] **Step 2: Renderizar a página corrente**

No tbody (linha 645), trocar `{filtered.map((t) => (` por `{pageRows.map((t) => (`. NADA mais muda na linha da tabela.

- [ ] **Step 3: Controles de paginação**

Imediatamente APÓS o fechamento do `<div className="card p-0 overflow-x-auto">` da tabela (o `</div>` que fecha o bloco iniciado na linha 615), adicionar:

```tsx
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
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Transacoes.tsx
git commit -m "feat(f9): transações paginadas na renderização (50/página, totais e lote sobre o filtro inteiro)"
```

---

### Task 4: Modais no lugar de alert/confirm em Transações

**Files:**
- Modify: `apps/web/src/pages/Transacoes.tsx`

**Interfaces:**
- Consumes: `Modal` de `../components/Modal`; handlers atuais `handleDelete` (375-380), `handleBulkDelete` (419-427), `handleBulkReclassify` (alert na 405), `handleBulkConfirm` (alert na 438); `TxRow` (tipo local da página); `loadTxs`, `clearSelection`, `selected`.
- Ao final: NENHUM `alert(`/`confirm(` em `Transacoes.tsx`.

- [ ] **Step 1: Estados novos**

Junto dos outros `useState` (perto da linha 104), adicionar:

```tsx
  // Exclusão com confirmação em Modal (F9: fim dos alert/confirm)
  const [deletingTx, setDeletingTx] = useState<TxRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
```

e `import { Modal } from '../components/Modal'` no topo (se ainda não houver).

- [ ] **Step 2: Trocar os handlers**

Substituir `handleDelete` (375-380) por:

```tsx
  async function confirmDeleteTx() {
    if (!deletingTx) return
    setActionError(null)
    const { error } = await supabase.from('transactions').delete().eq('id', deletingTx.id)
    if (error) { setActionError(error.message); setDeletingTx(null); return }
    setDeletingTx(null)
    await loadTxs(range.from, range.to)
  }
```

(no JSX, o botão de excluir da linha que chamava `handleDelete(t.id)` passa a chamar `setDeletingTx(t)`)

Substituir `handleBulkDelete` (419-427) por:

```tsx
  async function confirmBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) { setBulkDeleteOpen(false); return }
    setActionError(null)
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) { setActionError(error.message); setBulkDeleteOpen(false); return }
    setBulkDeleteOpen(false)
    await loadTxs(range.from, range.to)
    clearSelection()
  }
```

(o botão da barra de lote que chamava `handleBulkDelete()` passa a chamar `setBulkDeleteOpen(true)`)

Em `handleBulkReclassify`, trocar `if (error) { alert(error.message); setBulkSaving(false); return }` por `if (error) { setActionError(error.message); setBulkSaving(false); return }`.
Em `handleBulkConfirm`, trocar `if (error) { alert(error.message); return }` por `if (error) { setActionError(error.message); return }`.

- [ ] **Step 3: Erro inline + modais no JSX**

Logo abaixo do header da página (depois do bloco que mostra a contagem, perto da linha 460), adicionar:

```tsx
      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 border border-red-200">
          {actionError}
        </p>
      )}
```

Antes do fechamento do componente (junto dos outros modais/JSX final), adicionar:

```tsx
      {deletingTx && (
        <Modal
          title="Excluir transação"
          onClose={() => setDeletingTx(null)}
          footer={
            <>
              <button onClick={() => setDeletingTx(null)} className="btn-ghost">Cancelar</button>
              <button onClick={confirmDeleteTx} className="btn-primary">Excluir</button>
            </>
          }
        >
          <p className="text-sm text-ink">
            Excluir "{deletingTx.description}" ({fmtDate(deletingTx.occurred_on)})? Esta ação não pode ser desfeita.
          </p>
        </Modal>
      )}

      {bulkDeleteOpen && (
        <Modal
          title="Excluir em lote"
          onClose={() => setBulkDeleteOpen(false)}
          footer={
            <>
              <button onClick={() => setBulkDeleteOpen(false)} className="btn-ghost">Cancelar</button>
              <button onClick={confirmBulkDelete} className="btn-primary">Excluir {selected.size}</button>
            </>
          }
        >
          <p className="text-sm text-ink">
            Excluir {selected.size} transação{selected.size !== 1 ? 'ões' : ''}? Esta ação não pode ser desfeita.
          </p>
        </Modal>
      )}
```

(`fmtDate` já existe na página; se o nome for outro, usar o formatador de data local da página)

- [ ] **Step 4: Verificar que não sobrou alert/confirm**

Run: `grep -n "alert(\|confirm(" apps/web/src/pages/Transacoes.tsx`
Expected: nenhuma ocorrência

- [ ] **Step 5: Build + commit**

Run: `npm run web:build`
Expected: build OK

```bash
git add apps/web/src/pages/Transacoes.tsx
git commit -m "feat(f9): exclusão de transações (1 e em lote) com Modal e erro inline — fim dos alert/confirm"
```

---

### Task 5: Modais em Categorias e Objetivos

**Files:**
- Modify: `apps/web/src/pages/Categorias.tsx`
- Modify: `apps/web/src/pages/Objetivos.tsx`

**Interfaces:**
- Consumes: `Modal` de `../components/Modal`; `handleDelete(id, name)` de Categorias (linhas ~271-287, com detecção FK `23503`); `handleDelete(goal)` de Objetivos (linhas 76-84, usa `deleteGoal`/`reload`); tipo `Goal` local de Objetivos.
- Ao final: NENHUM `alert(`/`confirm(` em `apps/web/src`.

- [ ] **Step 1: Categorias**

Adicionar `import { Modal } from '../components/Modal'` (se faltar) e estados:

```tsx
  const [deletingCat, setDeletingCat] = useState<{ id: string; name: string } | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
```

Substituir `handleDelete` por:

```tsx
  async function confirmDeleteCat() {
    if (!deletingCat) return
    setDeleteError(null)
    const { error } = await supabase.from('categories').delete().eq('id', deletingCat.id)
    if (error) {
      const msg = error.message ?? ''
      const isFk = error.code === '23503' || /foreign key|violates/i.test(msg)
      setDeleteError(isFk ? 'Não dá para excluir: em uso por lançamentos ou possui subcategorias.' : msg)
      return
    }
    setDeletingCat(null)
    await load()
  }
```

Onde os botões chamavam `handleDelete(id, name)`, passar a chamar `setDeletingCat({ id, name })` (e `setDeleteError(null)`).

JSX (junto dos outros modais da página):

```tsx
      {deletingCat && (
        <Modal
          title="Excluir categoria"
          onClose={() => { setDeletingCat(null); setDeleteError(null) }}
          footer={
            <>
              <button onClick={() => { setDeletingCat(null); setDeleteError(null) }} className="btn-ghost">Cancelar</button>
              <button onClick={confirmDeleteCat} className="btn-primary">Excluir</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir "{deletingCat.name}"?</p>
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
        </Modal>
      )}
```

- [ ] **Step 2: Objetivos**

Adicionar `import { Modal } from '../components/Modal'` (se faltar) e estados:

```tsx
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
```

Substituir `handleDelete` por:

```tsx
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
```

Botões que chamavam `handleDelete(goal)` passam a chamar `setDeletingGoal(goal)` (e `setDeleteError(null)`).

JSX:

```tsx
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
```

- [ ] **Step 3: Verificar zero alert/confirm no app**

Run: `grep -rn "alert(\|window.confirm(" apps/web/src`
Expected: nenhuma ocorrência

- [ ] **Step 4: Build + commit**

Run: `npm run web:build`
Expected: build OK

```bash
git add apps/web/src/pages/Categorias.tsx apps/web/src/pages/Objetivos.tsx
git commit -m "feat(f9): exclusão com Modal em categorias e objetivos — zero alert/confirm no app"
```

---

### Task 6: Ajustes de mobile + SETUP.md + verificação final

**Files:**
- Modify: `apps/web/src/components/Layout.tsx:170` (padding do main)
- Modify: `apps/web/src/components/TopSubcategoriesChart.tsx:50` (YAxis)
- Modify: `apps/web/src/components/CategoryVsTargetChart.tsx:62` (YAxis)
- Modify: `SETUP.md` (seção Fase 9)

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Contexto: gráficos já usam `ResponsiveContainer width="100%"`, filtros já têm `flex-wrap`, a tabela de transações já rola em `overflow-x-auto` — a passada de mobile é pontual: mais largura útil no celular.

- [ ] **Step 1: Padding responsivo do main**

`Layout.tsx` linha 170: trocar `px-6 lg:px-10` por `px-4 md:px-6 lg:px-10`.

- [ ] **Step 2: Eixos dos gráficos de barra horizontal**

`TopSubcategoriesChart.tsx` linha ~50: no `YAxis`, trocar `width={150}` por `width={110}` e garantir `tick={{ fontSize: 12 }}` (se o tick já tiver outras props, só acrescentar/ajustar o fontSize).
`CategoryVsTargetChart.tsx` linha ~62: no `YAxis`, trocar `width={90}` por `width={80}` e garantir `tick={{ fontSize: 12 }}` idem.

- [ ] **Step 3: SETUP.md**

Adicionar após a seção "## 10. Fase 8", antes de "## Notas":

```markdown
## 11. Fase 9 (dashboard financeiro)

1. **Migração**: executar `supabase/migrations/0008_fase9.sql` (SQL Editor ou
   Management API) — função `monthly_cashflow` (agregação anual do dashboard).
2. Nada novo no `.env`.
3. **UAT**: no Dashboard, conferir que o gráfico anual e o "Saldo no ano"
   batem com os valores de antes (mesma lógica, agora agregada no banco);
   Transações paginada (50/página) com totais/seleção/export sobre o filtro
   inteiro; excluir transação/categoria/objetivo abre modal (sem popups do
   navegador); no celular, nenhuma página rola na horizontal (a tabela rola
   dentro do próprio quadro).
```

- [ ] **Step 4: Verificação completa**

Run: `npm run typecheck && npm test && npm run web:build`
Expected: typecheck limpo; suite PASS (server + web lib); build OK

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/components/TopSubcategoriesChart.tsx apps/web/src/components/CategoryVsTargetChart.tsx SETUP.md
git commit -m "feat(f9): ajustes de mobile (padding, eixos dos gráficos) + setup da fase 9"
```

---

## Self-review (feito na escrita do plano)

- **Cobertura da spec**: §1 agregação (T1 migração+hook+Dashboard; T2 loop no useFinance); §2 paginação client-side (T3, com T2 garantindo fetch completo); §3 modais (T4 Transações, T5 Categorias+Objetivos, greps de verificação); §4 mobile (T6, pontual — gráficos/filtros/tabela já responsivos, verificado no código); §5 testes (T2 vitest include + finance-data + fetchAllPages TDD); SETUP/UAT (T6). Fora da fase respeitado.
- **Tipos consistentes**: `fetchAllPages`/`PAGE_SIZE` (T2) usados em useFinance e loadTxs com a mesma assinatura; `MonthFlow.month` 0-11 preservado no hook (RPC 1-12 → -1); `TX_PAGE_SIZE`/`page`/`safePage`/`pageRows` só na T3.
- **Sem placeholders**: todos os steps de código mostram o código; os pontos de integração citam linha atual do arquivo.
