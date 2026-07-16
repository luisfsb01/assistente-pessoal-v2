import { describe, expect, it } from 'vitest';
import { decodeAction, encodeFinAction, encodeHabitAction, encodePtaskAction } from './callback.js';

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

describe('callbacks de hábito e tarefa de projeto', () => {
  it('hab codifica e decodifica', () => {
    expect(decodeAction(encodeHabitAction(true, 'h1'))).toEqual({ kind: 'hab', done: true, habitId: 'h1' });
    expect(decodeAction(encodeHabitAction(false, 'h1'))).toEqual({ kind: 'hab', done: false, habitId: 'h1' });
  });
  it('ptask codifica e decodifica', () => {
    expect(decodeAction(encodePtaskAction('done', 't1'))).toEqual({ kind: 'ptask', action: 'done', taskId: 't1' });
    expect(decodeAction(encodePtaskAction('keep', 't1'))).toEqual({ kind: 'ptask', action: 'keep', taskId: 't1' });
  });
  it('dados desconhecidos continuam null', () => {
    expect(decodeAction('hab:talvez:h1')).toBeNull();
    expect(decodeAction('ptask:zzz:t1')).toBeNull();
  });
});
