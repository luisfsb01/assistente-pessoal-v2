import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { applyOps, reflectionOutputSchema, type ReflectionOp } from './reflection.js';

describe('reflectionOutputSchema', () => {
  it('aceita saída válida do modelo', () => {
    const parsed = reflectionOutputSchema.parse({
      ops: [
        { action: 'add', subject: 'luis', type: 'preference', content: 'Prefere café sem açúcar' },
        { action: 'update', id: 'abc', content: 'Paga a fatura dia 6' },
        { action: 'expire', id: 'def' },
      ],
    });
    expect(parsed.ops).toHaveLength(3);
  });

  it('rejeita action desconhecida', () => {
    expect(() => reflectionOutputSchema.parse({ ops: [{ action: 'delete', id: 'x' }] })).toThrow();
  });
});

describe('applyOps', () => {
  it('aplica cada operação no repositório e conta', async () => {
    const calls: string[] = [];
    const ops: ReflectionOp[] = [
      { action: 'add', subject: 'casal', type: 'decision', content: 'Vão viajar em setembro' },
      { action: 'expire', id: 'old1' },
    ];
    const result = await applyOps(ops, {
      insert: async (op) => {
        calls.push(`insert:${op.content}`);
      },
      update: async (id, content) => {
        calls.push(`update:${id}:${content}`);
      },
      expire: async (id) => {
        calls.push(`expire:${id}`);
      },
    });
    expect(calls).toEqual(['insert:Vão viajar em setembro', 'expire:old1']);
    expect(result).toEqual({ added: 1, updated: 0, expired: 1 });
  });

  it('uma operação com erro não derruba as demais', async () => {
    const ops: ReflectionOp[] = [
      { action: 'expire', id: 'boom' },
      { action: 'add', subject: 'luis', type: 'fact', content: 'Trabalha com projetos de IA' },
    ];
    const result = await applyOps(ops, {
      insert: async () => {},
      update: async () => {},
      expire: async () => {
        throw new Error('não existe');
      },
    });
    expect(result).toEqual({ added: 1, updated: 0, expired: 0 });
  });
});
