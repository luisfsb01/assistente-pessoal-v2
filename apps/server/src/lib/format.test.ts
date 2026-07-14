import { describe, expect, it } from 'vitest';
import { formatBrl } from './format.js';

describe('formatBrl', () => {
  it('formata com vírgula decimal e 2 casas', () => {
    expect(formatBrl(24.9)).toBe('R$ 24,90');
    expect(formatBrl(1000)).toBe('R$ 1000,00');
  });
});
