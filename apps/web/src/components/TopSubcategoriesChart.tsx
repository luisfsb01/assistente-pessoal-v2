import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import type { SubcategorySpend } from '../lib/finance-data'
import { formatBrl } from '../lib/format'

interface Props {
  items: SubcategorySpend[]
  title?: string
  onClear?: () => void
}

export default function TopSubcategoriesChart({ items, title = 'Top 5 subcategorias', onClear }: Props) {
  const data = items.map((i) => ({ name: i.name, Valor: i.total }))

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">{title}</h2>
        {onClear && (
          <button onClick={onClear} className="text-sm text-brand-600 hover:underline">ver todas →</button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted text-sm">Sem gastos em subcategorias.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(240, items.length * 56)}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 6, right: 70, bottom: 6, left: 8 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="3 3"
              stroke="var(--color-hairline)"
            />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              stroke="#94a3b8"
              fontSize={14}
              tickLine={false}
              axisLine={false}
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
            <Bar dataKey="Valor" fill="#3b82f6" barSize={24} radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="Valor"
                position="right"
                formatter={(v) => formatBrl(Number(v))}
                fill="var(--color-muted)"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
