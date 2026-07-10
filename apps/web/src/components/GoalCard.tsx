import type { Goal } from '../lib/useGoals'
import { formatBrl } from '../lib/format'

export default function GoalCard({
  goal,
  onEdit,
  onDelete,
  readOnly,
}: {
  goal: Goal
  onEdit?: () => void
  onDelete?: () => void
  readOnly?: boolean
}) {
  const pct =
    goal.target_amount > 0
      ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
      : 0

  return (
    <div className="card flex flex-col justify-between">
      {/* Top row: name + edit/delete */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-lg text-ink">{goal.name}</span>
        {!readOnly && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="text-muted hover:text-ink text-base leading-none px-1"
              title="Editar"
            >
              ✏️
            </button>
            <button
              onClick={onDelete}
              className="text-muted hover:text-ink text-base leading-none px-1"
              title="Excluir"
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {/* Progress label row */}
      <div className="flex justify-between text-sm mt-3">
        <span className="text-muted">Progresso</span>
        <span className="text-brand-600 font-bold">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden mt-1">
        <div
          className="h-full bg-brand-500 rounded-full transition-[width]"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* Bottom: current / target amounts + remaining */}
      <div className="mt-3">
        <div className="flex justify-between items-end">
          <span className="text-lg font-bold text-ink">{formatBrl(goal.current_amount)}</span>
          <span className="text-sm text-muted">{formatBrl(goal.target_amount)}</span>
        </div>
        <p className="text-xs text-muted italic mt-1">
          Faltam {formatBrl(Math.max(0, goal.target_amount - goal.current_amount))}
        </p>
      </div>
    </div>
  )
}
