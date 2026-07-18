import { formatBrl } from '../lib/format'

interface KpiProps {
  label: string
  value: number
  variationPct?: number
  hero?: boolean
}

export default function Kpi({ label, value, variationPct, hero = false }: KpiProps) {
  const cardClass = hero ? 'card-hero' : 'card'
  const labelClass = hero ? 'text-sm text-white/70' : 'text-sm text-muted'
  const valueClass = [
    'mt-2 text-[clamp(1.15rem,1.65vw,1.75rem)] font-bold tracking-tight tabular-nums whitespace-nowrap',
    hero ? 'text-white' : '',
  ].join(' ')

  return (
    <div className={`${cardClass} min-w-0 overflow-hidden`}>
      <p className={labelClass}>{label}</p>
      <p className={valueClass}>{formatBrl(value)}</p>
      {variationPct !== undefined && (
        <div className="mt-1.5">
          {variationPct >= 0 ? (
            <span className="badge-up">&#9650; {variationPct}%</span>
          ) : (
            <span className="badge-down">&#9660; {Math.abs(variationPct)}%</span>
          )}
        </div>
      )}
    </div>
  )
}
