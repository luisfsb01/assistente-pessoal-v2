// Datas em ISO local (YYYY-MM-DD), sem Date/fuso: aritmética direta na string
// via Date.UTC para evitar surpresas de timezone no navegador.

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000)
}

/** Segunda-feira da semana da data (semana começa na segunda, padrão F7). */
export function mondayOf(iso: string): string {
  const weekday = new Date(toUtc(iso)).getUTCDay() // 0=domingo..6=sábado
  const back = weekday === 0 ? 6 : weekday - 1
  return addDaysIso(iso, -back)
}

/** Matriz de semanas (mais antiga primeiro; última = semana corrente), 7 dias seg→dom. */
export function gridWeeks(todayIso: string, weeks: number): string[][] {
  const currentMonday = mondayOf(todayIso)
  const rows: string[][] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDaysIso(currentMonday, -7 * w)
    rows.push(Array.from({ length: 7 }, (_, d) => addDaysIso(monday, d)))
  }
  return rows
}

export function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
