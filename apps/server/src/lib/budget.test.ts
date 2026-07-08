import { describe, expect, it } from 'vitest';
import { budgetStatus } from './budget.js';

describe('budgetStatus', () => {
  it('ok abaixo de 80%', () => expect(budgetStatus(39.9, 50)).toBe('ok'));
  it('warn em 80%', () => expect(budgetStatus(40, 50)).toBe('warn'));
  it('exceeded em 100%', () => expect(budgetStatus(50, 50)).toBe('exceeded'));
  it('exceeded acima do teto', () => expect(budgetStatus(70, 50)).toBe('exceeded'));
});
