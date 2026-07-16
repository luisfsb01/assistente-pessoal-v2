import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { bearerToken } from './auth.js';

describe('bearerToken', () => {
  it('extrai o token de um header Bearer', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('rejeita header ausente, vazio ou sem Bearer', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
});
