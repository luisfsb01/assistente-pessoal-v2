import { describe, expect, it } from 'vitest';
import { nextReviewCode } from './review-code.js';

describe('nextReviewCode', () => {
  it('começa em A001 sem código anterior ou com código inválido', () => {
    expect(nextReviewCode(null)).toBe('A001');
    expect(nextReviewCode('xyz')).toBe('A001');
  });
  it('incrementa dentro da letra e troca de letra em 999', () => {
    expect(nextReviewCode('A001')).toBe('A002');
    expect(nextReviewCode('A999')).toBe('B001');
    expect(nextReviewCode('Z999')).toBe('A001');
  });
});
