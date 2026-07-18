import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Kpi from './Kpi'

describe('Kpi', () => {
  it('formata moeda e sinaliza variação positiva/negativa', () => {
    expect(renderToStaticMarkup(<Kpi label="Saldo" value={1234.5} variationPct={10} />))
      .toContain('1.234,50')
    expect(renderToStaticMarkup(<Kpi label="Saldo" value={-10} variationPct={-5} />))
      .toContain('5%')
  })
})
