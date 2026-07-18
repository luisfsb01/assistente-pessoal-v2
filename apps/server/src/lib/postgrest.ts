/** Escapa metacaracteres de LIKE/ILIKE antes de interpolar entrada do usuário. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
