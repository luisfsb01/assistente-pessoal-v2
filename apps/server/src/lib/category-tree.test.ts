import { describe, expect, it } from 'vitest';
import { categoryPath, rootCategoryOf, type CategoryNode } from './category-tree.js';

const cats: CategoryNode[] = [
  { id: 'r1', name: 'Casa', parent_id: null, monthly_target: 2000, counts: true, type: 'expense' },
  { id: 's1', name: 'Energia', parent_id: 'r1', monthly_target: null, counts: true, type: 'expense' },
  { id: 'r2', name: 'Investimentos', parent_id: null, monthly_target: null, counts: true, type: 'investment' },
];

describe('categoryPath', () => {
  it('subcategoria vira "Pai > Filho"; raiz é só o nome; id desconhecido é null', () => {
    expect(categoryPath('s1', cats)).toBe('Casa > Energia');
    expect(categoryPath('r1', cats)).toBe('Casa');
    expect(categoryPath('zz', cats)).toBeNull();
  });
});

describe('rootCategoryOf', () => {
  it('sobe até a raiz', () => {
    expect(rootCategoryOf('s1', cats)?.id).toBe('r1');
    expect(rootCategoryOf('r2', cats)?.id).toBe('r2');
    expect(rootCategoryOf('zz', cats)).toBeNull();
  });
});
