export type TaskDates = {
  status: 'open' | 'done'
  due_date: string | null
  initial_due_date?: string | null
}

export type TaskVisualStatus = 'open' | 'overdue' | 'done'
export type TaskRecurrenceUnit = 'day' | 'week' | 'month'

export function formatTaskDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function taskVisualStatus(task: TaskDates, today: string): TaskVisualStatus {
  if (task.status === 'done') return 'done'
  if (task.due_date && task.due_date < today) return 'overdue'
  return 'open'
}

export function taskDeadlineView(task: TaskDates): {
  initial: string | null
  current: string | null
  changed: boolean
} {
  const initial = task.initial_due_date ?? task.due_date
  const hasStoredInitial = task.initial_due_date !== undefined && task.initial_due_date !== null
  return {
    initial,
    current: task.due_date,
    changed: hasStoredInitial && task.due_date !== task.initial_due_date,
  }
}

export function taskRecurrenceLabel(
  unit: TaskRecurrenceUnit,
  interval: number,
  untilDate: string,
): string {
  if (interval === 1) {
    const cadence = { day: 'Todo dia', week: 'Toda semana', month: 'Todo mês' }[unit]
    return `${cadence} · até ${formatTaskDate(untilDate)}`
  }
  const units = { day: 'dias', week: 'semanas', month: 'meses' }[unit]
  return `A cada ${interval} ${units} · até ${formatTaskDate(untilDate)}`
}
