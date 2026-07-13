/** Próximo código curto de revisão: A001..A999, B001.., até Z999, depois recomeça. */
export function nextReviewCode(current: string | null): string {
  const m = current?.match(/^([A-Z])(\d{3})$/);
  if (!m) return 'A001';
  const letter = m[1];
  const num = Number(m[2]);
  if (num < 999) return `${letter}${String(num + 1).padStart(3, '0')}`;
  if (letter === 'Z') return 'A001';
  return `${String.fromCharCode(letter.charCodeAt(0) + 1)}001`;
}
