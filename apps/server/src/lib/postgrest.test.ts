import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './postgrest.js';

describe('escapeLikePattern', () => {
  it('escapa wildcard e barra sem alterar texto comum', () => {
    expect(escapeLikePattern('100%_ok\\fim')).toBe('100\\%\\_ok\\\\fim');
    expect(escapeLikePattern('Projeto Site')).toBe('Projeto Site');
  });
});
