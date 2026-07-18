import { useState } from 'react'
import { type PeriodKey, PERIOD_LABELS, periodRange, previousRange } from '../lib/period'
import { kpis, variation, spendingByRootCategory, topSubcategories, subcategoriesOfRoot, withAccumulatedBalance, isCounted } from '../lib/finance-data'
import { useFinance } from '../lib/useFinance'
import { useYearCashflow } from '../lib/useYearCashflow'
import Kpi from '../components/Kpi'
import IncomeExpenseChart from '../components/IncomeExpenseChart'
import CategoryVsTargetChart from '../components/CategoryVsTargetChart'
import TopSubcategoriesChart from '../components/TopSubcategoriesChart'
import GoalsSection from '../components/GoalsSection'

const KPI_GRID_STYLE = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr))',
}

export default function Dashboard() {
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)

  const range = periodRange(period)
  const prev = previousRange(period)

  const curr = useFinance(range)
  const prevData = useFinance(prev)
  const yearFlow = useYearCashflow(new Date().getFullYear())
  const yearBalance = yearFlow.flow.reduce((s, f) => s + f.income - f.expense - f.invested, 0)

  // Exclui categorias marcadas counts=false dos KPIs e do fluxo de caixa.
  const countedCurr = curr.txs.filter((t) => isCounted(t.category_id, curr.categories))
  const countedPrev = prevData.txs.filter((t) => isCounted(t.category_id, prevData.categories))

  const k = kpis(countedCurr, curr.categories)
  const kp = kpis(countedPrev, prevData.categories)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Visão geral</h1>
          <p className="text-sm text-muted mt-0.5">Resumo das suas finanças</p>
        </div>
        <select
          className="input w-auto max-w-full"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodKey)}
        >
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
            <option key={key} value={key}>
              {PERIOD_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      {curr.loading || prevData.loading ? (
        <div className="grid gap-4" style={KPI_GRID_STYLE}>
          <div className="card animate-pulse h-28" />
          <div className="card animate-pulse h-28" />
          <div className="card animate-pulse h-28" />
          <div className="card animate-pulse h-28" />
          <div className="card animate-pulse h-28" />
        </div>
      ) : curr.error ? (
        <div className="card text-red-600">{curr.error}</div>
      ) : (
        <div className="grid gap-4" style={KPI_GRID_STYLE}>
          <Kpi
            hero
            label="Saldo do período"
            value={k.balance}
            variationPct={variation(k.balance, kp.balance)}
          />
          <Kpi
            label="Receitas"
            value={k.income}
            variationPct={variation(k.income, kp.income)}
          />
          <Kpi
            label="Despesas"
            value={k.expense}
            variationPct={-variation(k.expense, kp.expense)}
          />
          <Kpi
            label="Investido no período"
            value={k.invested}
            variationPct={variation(k.invested, kp.invested)}
          />
          <Kpi
            label="Saldo no ano"
            value={yearBalance}
          />
        </div>
      )}

      {/* Charts + sections */}
      {!curr.loading && (
        <>
          {/* Receitas x Despesas — full width */}
          <div className="mt-5">
            {yearFlow.loading ? (
              <div className="card animate-pulse h-96" />
            ) : yearFlow.error ? (
              <div className="card text-red-600">{yearFlow.error}</div>
            ) : (
              <IncomeExpenseChart data={withAccumulatedBalance(yearFlow.flow)} />
            )}
          </div>

          {/* Categoria vs meta + Top subcategorias */}
          <div className="grid gap-5 md:grid-cols-2 mt-5">
            <CategoryVsTargetChart
              items={spendingByRootCategory(curr.txs, curr.categories)}
              selected={selectedCat}
              onSelect={(name) => setSelectedCat((c) => (c === name ? null : name))}
            />
            <TopSubcategoriesChart
              items={selectedCat ? subcategoriesOfRoot(curr.txs, curr.categories, selectedCat) : topSubcategories(curr.txs, curr.categories)}
              title={selectedCat ? `Subcategorias: ${selectedCat}` : 'Top 5 subcategorias'}
              onClear={selectedCat ? () => setSelectedCat(null) : undefined}
            />
          </div>

          {/* Meus Objetivos */}
          <GoalsSection />
        </>
      )}
    </div>
  )
}
