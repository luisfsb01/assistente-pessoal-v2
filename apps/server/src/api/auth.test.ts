import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { bearerToken, isValidAccessToken, type AuthDeps } from './auth.js';

describe('bearerToken', () => {
  it('extrai o token de um header Bearer', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('rejeita header ausente, vazio ou sem Bearer', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken('bearer abc')).toBe('abc');
  });
});

describe('isValidAccessToken', () => {
  function deps(userId: string | null, member: boolean): AuthDeps {
    return { getUserId: async () => userId, isMember: async () => member };
  }

  it('falha fechado para JWT inválido ou conta fora de app_members', async () => {
    expect(await isValidAccessToken('x', deps(null, true))).toBe(false);
    expect(await isValidAccessToken('x', deps('u1', false))).toBe(false);
  });

  it('aceita apenas JWT válido de membro explícito', async () => {
    expect(await isValidAccessToken('x', deps('u1', true))).toBe(true);
  });
});
