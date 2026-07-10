export type PeriodKey = 'this_month' | 'last_month' | 'last_3m' | 'year'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_month: 'Este mês',
  last_month: 'Mês passado',
  last_3m: 'Últimos 3 meses',
  year: 'Este ano',
}

export const MES_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export interface Range { from: string; to: string }

function iso(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

/** Intervalo [from,to] em YYYY-MM-DD para a chave de período. `today` injetável. */
export function periodRange(key: PeriodKey, today: Date = new Date()): Range {
  const y = today.getFullYear()
  const m = today.getMonth()
  const todayIso = iso(today)
  if (key === 'this_month') return { from: iso(new Date(y, m, 1)), to: todayIso }
  if (key === 'last_month') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
  if (key === 'last_3m') return { from: iso(new Date(y, m - 2, 1)), to: todayIso }
  return { from: iso(new Date(y, 0, 1)), to: todayIso } // year
}

/** O período imediatamente anterior, de mesma natureza, para cálculo de variação. */
export function previousRange(key: PeriodKey, today: Date = new Date()): Range {
  const y = today.getFullYear()
  const m = today.getMonth()
  if (key === 'this_month') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
  if (key === 'last_month') return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m - 1, 0)) }
  if (key === 'last_3m') return { from: iso(new Date(y, m - 5, 1)), to: iso(new Date(y, m - 2, 0)) }
  return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) } // ano anterior
}

export function yearRange(today: Date = new Date()): Range {
  const y = today.getFullYear()
  return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) }
}
