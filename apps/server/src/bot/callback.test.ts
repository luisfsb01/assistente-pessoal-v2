import { describe, expect, it } from 'vitest';
import { decodeAction, encodeFinAction } from './callback.js';

describe('callback codec', () => {
  it('roundtrip fin:ok', () => {
    const data = encodeFinAction('ok', 'abc-123');
    expect(decodeAction(data)).toEqual({ kind: 'fin', action: 'ok', txId: 'abc-123' });
  });
  it('rejeita payloads desconhecidos', () => {
    expect(decodeAction('task:done:1')).toBeNull();
    expect(decodeAction('fin:nope:1')).toBeNull();
    expect(decodeAction('fin:ok:')).toBeNull();
    expect(decodeAction('lixo')).toBeNull();
  });
});
