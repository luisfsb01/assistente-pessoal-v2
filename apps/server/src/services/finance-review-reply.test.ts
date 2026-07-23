import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import { handleFinanceReviewReply, type FinanceReviewReplyDeps } from './finance-review-reply.js';

const category = (id: string, name: string): Category => ({
  id,
  name,
  parent_id: null,
  monthly_target: null,
  counts: true,
  type: 'expense',
});

const transaction = (id: string, code: string, description: string): Transaction => ({
  id,
  review_code: code,
  description,
  occurred_on: '2026-07-18',
  amount: 10,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
});

function makeDeps(): { deps: FinanceReviewReplyDeps; calls: string[] } {
  const calls: string[] = [];
  const transactions = new Map([
    ['A045', transaction('t45', 'A045', 'LOJA TESTE 45')],
    ['A048', transaction('t48', 'A048', 'LOJA TESTE 48')],
  ]);
  const categories = new Map([['compras necessarias', category('c1', 'Compras Necessarias')]]);
  return {
    calls,
    deps: {
      getTransactionByReviewCode: async (code) => transactions.get(code) ?? null,
      getCategoryByName: async (name) => categories.get(name.toLocaleLowerCase('pt-BR')) ?? null,
      setTransactionCategory: async (transactionId, categoryId) => {
        calls.push(`set:${transactionId}:${categoryId}`);
        return true;
      },
      learnRule: async (description, categoryId) => void calls.push(`learn:${description}:${categoryId}`),
    },
  };
}

describe('handleFinanceReviewReply', () => {
  it('persiste todo lote de confirmacoes e aceita categoria sem diferenciar maiusculas', async () => {
    const { deps, calls } = makeDeps();
    await expect(
      handleFinanceReviewReply('A045 - Compras Necessarias\nA048 - compras necessarias', deps),
    ).resolves.toBe('Pronto — registrei A045, A048.');
    expect(calls).toEqual([
      'set:t45:c1',
      'learn:LOJA TESTE 45:c1',
      'set:t48:c1',
      'learn:LOJA TESTE 48:c1',
    ]);
  });

  it('aceita o formato com e exibido pela revisao diaria', async () => {
    const { deps } = makeDeps();
    await expect(handleFinanceReviewReply('A045 e Compras Necessarias', deps)).resolves.toBe(
      'Pronto — registrei A045.',
    );
  });

  it('nao altera nenhuma transacao quando um codigo do lote nao existe', async () => {
    const { deps, calls } = makeDeps();
    await expect(handleFinanceReviewReply('A045 - Compras Necessarias\nA999 - Compras Necessarias', deps)).resolves.toBe(
      'Não encontrei a transação A999. Nada foi alterado.',
    );
    expect(calls).toEqual([]);
  });

  it('deixa mensagens comuns seguirem para o agente', async () => {
    const { deps } = makeDeps();
    await expect(handleFinanceReviewReply('Pode classificar A045 como compras?', deps)).resolves.toBeNull();
  });
});
