import { describe, expect, it } from 'vitest'
import { escapeLikePattern } from './postgrest'

describe('escapeLikePattern', () => {
  it('escapa metacaracteres de ilike', () => {
    expect(escapeLikePattern('100%_ok')).toBe('100\\%\\_ok')
  })
})
