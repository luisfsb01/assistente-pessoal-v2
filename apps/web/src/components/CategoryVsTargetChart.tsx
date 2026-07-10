import {
  ComposedChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { CategorySpend } from '../lib/finance-data'
import { formatBrl } from '../lib/format'

interface Props {
  items: CategorySpend[]
  onSelect?: (category: string) => void
  selected?: string | null
}

export default function CategoryVsTargetChart({ items, onSelect, selected }: Props) {
  const data = items.map((i) => ({
    category: i.name,
    Realizado: i.total,
    Meta: i.monthlyTarget ?? 0,
  }))

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">Gasto por categoria vs meta</h2>
        <span className="text-xs text-muted">clique numa categoria para filtrar</span>
      </div>

      {items.length === 0 ? (
        <p className="text-muted text-sm">Nenhum gasto no período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(260, items.length * 48)}>
          <ComposedChart
            layout="vertical"
            data={data}
            margin={{ top: 6, right: 60, bottom: 6, left: 8 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="3 3"
              stroke="var(--color-hairline)"
            />
            <XAxis
              type="number"
              stroke="#94a3b8"
              fontSize={14}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => 'R$' + v / 1000 + 'k'}
            />
            <YAxis
              yAxisId={0}
              type="category"
              dataKey="category"
              width={90}
              stroke="#94a3b8"
              fontSize={14}
              tickLine={false}
              axisLine={false}
            />
            <YAxis yAxisId={1} type="category" dataKey="category" hide />
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
            <Bar dataKey="Meta" yAxisId={0} barSize={28} fill="#94a3b8" fillOpacity={0.35} radius={[0, 4, 4, 0]} />
            <Bar
              dataKey="Realizado"
              yAxisId={1}
              barSize={16}
              radius={[0, 4, 4, 0]}
              cursor="pointer"
              onClick={(d: any) => onSelect?.(d?.category)}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.Meta > 0 && d.Realizado > d.Meta ? '#f43f5e' : '#10b981'}
                  fillOpacity={!selected || d.category === selected ? 1 : 0.35}
                />
              ))}
              <LabelList dataKey="Realizado" position="right" fontSize={11} fill="var(--color-muted)" formatter={(v: unknown) => formatBrl(Number(v))} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
