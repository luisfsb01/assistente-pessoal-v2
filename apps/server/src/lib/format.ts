export function formatBrl(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}
