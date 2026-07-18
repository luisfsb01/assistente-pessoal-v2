import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBrl } from '../lib/format'

interface Props {
  history: Array<{ month: string; costBrl: number }>
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function llmMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${MONTHS[monthNumber - 1]}/${String(year).slice(-2)}`
}

export default function LlmCostChart({ history }: Props) {
  const data = history.map((item) => ({
    month: llmMonthLabel(item.month),
    custo: item.costBrl,
  }))

  return (
    <div className="mt-5 border-t border-hairline pt-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink">Gastos nos últimos 12 meses</h3>
        <p className="mt-0.5 text-xs text-muted">Custo efetivamente registrado por mês</p>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={58}
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              tickFormatter={(value) => `R$${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-2)' }}
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 12,
                color: 'var(--color-ink)',
              }}
              formatter={(value) => [formatBrl(Number(value)), 'Custo']}
            />
            <Bar dataKey="custo" fill="var(--color-brand-500)" radius={[5, 5, 0, 0]} maxBarSize={34} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
