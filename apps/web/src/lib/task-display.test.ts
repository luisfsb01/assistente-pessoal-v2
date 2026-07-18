import { describe, expect, it } from 'vitest'
import { formatTaskDate, taskDeadlineView, taskRecurrenceLabel, taskVisualStatus } from './task-display'

describe('task display', () => {
  it('formata a data completa em pt-BR', () => {
    expect(formatTaskDate('2026-07-14')).toBe('14/07/2026')
    expect(formatTaskDate(null)).toBe('—')
  })

  it('distingue tarefa aberta, atrasada e concluída', () => {
    expect(taskVisualStatus({ status: 'open', due_date: '2026-07-20' }, '2026-07-18')).toBe('open')
    expect(taskVisualStatus({ status: 'open', due_date: '2026-07-17' }, '2026-07-18')).toBe('overdue')
    expect(taskVisualStatus({ status: 'done', due_date: '2026-07-17' }, '2026-07-18')).toBe('done')
  })

  it('preserva o prazo inicial e detecta alteração ou remoção', () => {
    expect(taskDeadlineView({ status: 'open', initial_due_date: '2026-07-14', due_date: '2026-07-20' }))
      .toEqual({ initial: '2026-07-14', current: '2026-07-20', changed: true })
    expect(taskDeadlineView({ status: 'open', initial_due_date: '2026-07-14', due_date: null }))
      .toEqual({ initial: '2026-07-14', current: null, changed: true })
  })

  it('descreve a frequência e a data final da recorrência', () => {
    expect(taskRecurrenceLabel('week', 1, '2026-12-31')).toBe('Toda semana · até 31/12/2026')
    expect(taskRecurrenceLabel('month', 2, '2027-01-31')).toBe('A cada 2 meses · até 31/01/2027')
  })
})
