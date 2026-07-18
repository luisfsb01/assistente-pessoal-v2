import { describe, expect, it } from 'vitest'
import { llmMonthLabel } from './LlmCostChart'

describe('LlmCostChart', () => {
  it('formata o mês em português', () => {
    expect(llmMonthLabel('2026-01')).toBe('Jan/26')
    expect(llmMonthLabel('2026-12')).toBe('Dez/26')
  })
})
