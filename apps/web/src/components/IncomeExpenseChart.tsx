import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import type { MonthFlowAcc } from '../lib/finance-data'
import { MES_LABELS } from '../lib/period'
import { formatBrl } from '../lib/format'

interface Props {
  data: MonthFlowAcc[]
}

export default function IncomeExpenseChart({ data }: Props) {
  const chart = data.map((d) => ({
    name: MES_LABELS[d.month],
    Receitas: d.income,
    Despesas: d.expense,
    Investido: d.invested,
    'Saldo acumulado': d.balanceAcc,
  }))

  const compact = (v: unknown) => {
    const n = Number(v)
    return n > 0 ? (n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(Math.round(n))) : ''
  }

  return (
    <div className="card">
      <h2 className="font-semibold text-lg mb-2">Receitas × Despesas</h2>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={chart} margin={{ top: 10, right: 16, bottom: 0, left: 0 }} barGap={2} barCategoryGap="18%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#94a3b8"
            fontSize={14}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={14}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => 'R$' + (v / 1000) + 'k'}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 12,
              color: 'var(--color-ink)',
            }}
            formatter={(v) => formatBrl(Number(v))}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32}>
            <LabelList dataKey="Receitas" position="top" fontSize={9} fill="var(--color-muted)" formatter={compact} />
          </Bar>
          <Bar dataKey="Despesas" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={32}>
            <LabelList dataKey="Despesas" position="top" fontSize={9} fill="var(--color-muted)" formatter={compact} />
          </Bar>
          <Bar dataKey="Investido" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={32}>
            <LabelList dataKey="Investido" position="top" fontSize={9} fill="var(--color-muted)" formatter={compact} />
          </Bar>
          <Line type="monotone" dataKey="Saldo acumulado" stroke="var(--color-surface)" strokeWidth={6} strokeDasharray="5 5" strokeLinecap="round" dot={false} legendType="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="Saldo acumulado" stroke="#3b82f6" strokeWidth={3} strokeDasharray="5 5" strokeLinecap="round" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
