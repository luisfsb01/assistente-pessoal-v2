import { describe, expect, it } from 'vitest'
import { fetchAllPages, PAGE_SIZE } from './fetch-all-pages'

function page(n: number, start = 0): number[] {
  return Array.from({ length: n }, (_, i) => start + i)
}

describe('fetchAllPages', () => {
  it('página única curta: uma chamada, retorna as linhas', async () => {
    const calls: Array<[number, number]> = []
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to])
      return { data: page(3), error: null }
    })
    expect(result).toEqual({ rows: page(3), error: null })
    expect(calls).toEqual([[0, PAGE_SIZE - 1]])
  })

  it('concatena páginas cheias até vir página curta, com janelas certas', async () => {
    const pages = [page(PAGE_SIZE, 0), page(PAGE_SIZE, PAGE_SIZE), page(10, 2 * PAGE_SIZE)]
    const calls: Array<[number, number]> = []
    const result = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to])
      return { data: pages[calls.length - 1], error: null }
    })
    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(2 * PAGE_SIZE + 10)
    expect(result.rows[0]).toBe(0)
    expect(result.rows.at(-1)).toBe(2 * PAGE_SIZE + 9)
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ])
  })

  it('erro em qualquer página interrompe e propaga a mensagem', async () => {
    let n = 0
    const result = await fetchAllPages<number>(async () => {
      n++
      if (n === 2) return { data: null, error: { message: 'boom' } }
      return { data: page(PAGE_SIZE), error: null }
    })
    expect(result).toEqual({ rows: [], error: 'boom' })
    expect(n).toBe(2)
  })

  it('data null sem erro conta como página vazia (curta)', async () => {
    const result = await fetchAllPages<number>(async () => ({ data: null, error: null }))
    expect(result).toEqual({ rows: [], error: null })
  })
})
