import { describe, expect, it } from 'vitest';
import { normalizePattern } from './finance.js';

describe('normalizePattern', () => {
  it('minúsculas, sem acentos, sem dígitos/pontuação, espaços colapsados', () => {
    expect(normalizePattern('UBER *TRIP 1234 SÃO PAULO')).toBe('uber trip sao paulo');
    expect(normalizePattern('PADARIA  DOCE-LAR 99')).toBe('padaria doce lar');
    expect(normalizePattern('123 456')).toBe('');
  });
});
