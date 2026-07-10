import { describe, it, expect } from 'vitest'
import {
  isInvestment,
  kpis,
  monthlyCashflow,
  withAccumulatedBalance,
  spendingByRootCategory,
  type Category,
  type Tx,
  type MonthFlow,
} from './finance-data'

function cat(p: Partial<Category> & { id: string }): Category {
  return {
    id: p.id,
    name: p.name ?? p.id,
    parent_id: p.parent_id ?? null,
    monthly_target: p.monthly_target ?? null,
    counts: p.counts ?? true,
    type: p.type ?? 'expense',
  }
}
function tx(p: Partial<Tx> & { id: string }): Tx {
  return {
    id: p.id,
    occurred_on: p.occurred_on ?? '2026-06-01',
    description: p.description ?? '',
    amount: p.amount ?? 0,
    kind: p.kind ?? 'expense',
    category_id: p.category_id ?? null,
    status: p.status ?? 'confirmed',
    category_name: p.category_name ?? null,
  }
}

const categories: Category[] = [
  cat({ id: 'food', type: 'expense' }),
  cat({ id: 'salary', type: 'income' }),
  cat({ id: 'inv', type: 'investment' }),
  cat({ id: 'inv-rf', parent_id: 'inv', type: 'investment' }),
]

describe('isInvestment', () => {
  it('true para raiz de investimento', () => expect(isInvestment('inv', categories)).toBe(true))
  it('true para subcategoria de investimento (via raiz)', () => expect(isInvestment('inv-rf', categories)).toBe(true))
  it('false para despesa', () => expect(isInvestment('food', categories)).toBe(false))
  it('false para nulo/desconhecido', () => {
    expect(isInvestment(null, categories)).toBe(false)
    expect(isInvestment('xxx', categories)).toBe(false)
  })
})

describe('kpis com investimento', () => {
  it('separa investido; balance = income - expense - invested', () => {
    const txs: Tx[] = [
      tx({ id: '1', kind: 'income', amount: 10000, category_id: 'salary' }),
      tx({ id: '2', kind: 'expense', amount: 6000, category_id: 'food' }),
      tx({ id: '3', kind: 'expense', amount: 2000, category_id: 'inv-rf' }),
    ]
    const k = kpis(txs, categories)
    expect(k.income).toBe(10000)
    expect(k.expense).toBe(6000)
    expect(k.invested).toBe(2000)
    expect(k.balance).toBe(2000)
  })
  it('entrada em categoria de investimento reduz o investido (resgate)', () => {
    const txs: Tx[] = [
      tx({ id: '1', kind: 'expense', amount: 2000, category_id: 'inv' }),
      tx({ id: '2', kind: 'income', amount: 500, category_id: 'inv' }),
    ]
    const k = kpis(txs, categories)
    expect(k.invested).toBe(1500)
    expect(k.income).toBe(0)
    expect(k.expense).toBe(0)
    expect(k.balance).toBe(-1500)
  })
})

describe('monthlyCashflow exclui investimento da despesa', () => {
  it('investimento vai para invested, não expense', () => {
    const txs: Tx[] = [
      tx({ id: '1', occurred_on: '2026-03-10', kind: 'income', amount: 5000, category_id: 'salary' }),
      tx({ id: '2', occurred_on: '2026-03-15', kind: 'expense', amount: 1000, category_id: 'food' }),
      tx({ id: '3', occurred_on: '2026-03-20', kind: 'expense', amount: 800, category_id: 'inv' }),
    ]
    const flow = monthlyCashflow(txs, 2026, categories)
    expect(flow[2]).toEqual({ month: 2, income: 5000, expense: 1000, invested: 800 })
  })
})

describe('withAccumulatedBalance subtrai investido', () => {
  it('acc = income - expense - invested', () => {
    const flow: MonthFlow[] = [
      { month: 0, income: 5000, expense: 1000, invested: 800 },
      { month: 1, income: 3000, expense: 500, invested: 0 },
    ]
    const acc = withAccumulatedBalance(flow)
    expect(acc[0].balanceAcc).toBe(3200)
    expect(acc[1].balanceAcc).toBe(5700)
  })
})

describe('spendingByRootCategory exclui investimento', () => {
  it('não inclui categorias de investimento', () => {
    const txs: Tx[] = [
      tx({ id: '1', kind: 'expense', amount: 1000, category_id: 'food' }),
      tx({ id: '2', kind: 'expense', amount: 800, category_id: 'inv' }),
    ]
    const rows = spendingByRootCategory(txs, categories)
    expect(rows.map((r) => r.name)).toEqual(['food'])
  })
})
