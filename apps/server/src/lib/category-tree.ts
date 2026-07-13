export interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  monthly_target: number | null;
  counts: boolean;
  type: 'income' | 'expense' | 'investment';
}

/** "Casa > Energia" para subcategoria; só o nome para raiz; null se id desconhecido. */
export function categoryPath(id: string, cats: CategoryNode[]): string | null {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const cat = byId.get(id);
  if (!cat) return null;
  if (!cat.parent_id) return cat.name;
  const parent = byId.get(cat.parent_id);
  return parent ? `${parent.name} > ${cat.name}` : cat.name;
}

/** Categoria raiz de um id (ela mesma se já for raiz); null se desconhecido. */
export function rootCategoryOf(id: string, cats: CategoryNode[]): CategoryNode | null {
  const byId = new Map(cats.map((c) => [c.id, c]));
  let cat = byId.get(id) ?? null;
  let guard = 0;
  while (cat?.parent_id && guard++ < 10) {
    cat = byId.get(cat.parent_id) ?? cat;
    if (!cat.parent_id) break;
  }
  return cat;
}
