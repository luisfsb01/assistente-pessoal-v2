import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import {
  handleFinanceClassificationComplaint,
  isFinanceClassificationComplaint,
  type FinanceClassificationAuditDeps,
} from './finance-classification-audit.js';

const category: Category = {
  id: 'c1',
  name: 'Compras Necessárias',
  parent_id: null,
  monthly_target: null,
  counts: true,
  type: 'expense',
};

function transaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't45',
    review_code: 'A045',
    description: 'LOJA TESTE',
    occurred_on: '2026-07-18',
    amount: 10,
    kind: 'expense',
    source: 'bank',
    category_id: null,
    status: 'pending_review',
    ...over,
  };
}

function makeDeps(row = transaction()): {
  deps: FinanceClassificationAuditDeps;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      getTransactionByReviewCode: async (code) => code === 'A045' ? row : null,
      getTransactionById: async (id) => id === row.id ? row : null,
      getCategoryByName: async (name) =>
        name.toLocaleLowerCase('pt-BR') === category.name.toLocaleLowerCase('pt-BR') ? category : null,
      setTransactionCategory: async (id, categoryId) => {
        calls.push(`set:${id}:${categoryId}`);
        row.category_id = categoryId;
        row.status = 'confirmed';
        return true;
      },
      learnRule: async (description, categoryId) => void calls.push(`learn:${description}:${categoryId}`),
    },
  };
}

describe('handleFinanceClassificationComplaint', () => {
  it('reconhece reclamacoes sem interceptar conversa financeira comum', () => {
    expect(isFinanceClassificationComplaint('Ontem pedi para classificar e não foi classificado.')).toBe(true);
    expect(isFinanceClassificationComplaint('Quanto gastei ontem?')).toBe(false);
  });

  it('recupera a ultima classificacao do historico, repara e confirma por releitura', async () => {
    const { deps, calls } = makeDeps();
    const out = await handleFinanceClassificationComplaint(
      'Ontem mandei classificar isso e não foi reclassificado.',
      [
        { role: 'user', content: 'A045 - Compras Necessárias' },
        { role: 'assistant', content: 'Pronto — registrei A045.' },
      ],
      deps,
    );

    expect(out).toContain('corrigi agora e confirmei no banco');
    expect(calls).toEqual(['set:t45:c1', 'learn:LOJA TESTE:c1']);
  });

  it('aceita codigo e categoria informados na propria reclamacao', async () => {
    const { deps } = makeDeps();
    const out = await handleFinanceClassificationComplaint(
      'A45 não foi classificada como Compras Necessárias.',
      [],
      deps,
    );
    expect(out).toContain('A045 como Compras Necessárias');
  });

  it('somente informa quando a classificacao ja esta correta', async () => {
    const { deps, calls } = makeDeps(transaction({ category_id: 'c1', status: 'confirmed' }));
    const out = await handleFinanceClassificationComplaint(
      'Você disse que classificou, mas quero conferir.',
      [{ role: 'user', content: 'A045 - Compras Necessárias' }],
      deps,
    );
    expect(out).toContain('já está classificada e confirmada');
    expect(calls).toEqual([]);
  });

  it('nao afirma sucesso se a releitura continuar divergente', async () => {
    const row = transaction();
    const { deps, calls } = makeDeps(row);
    deps.setTransactionCategory = async (id, categoryId) => {
      calls.push(`set:${id}:${categoryId}`);
      return true;
    };
    const out = await handleFinanceClassificationComplaint(
      'Ontem pedi para classificar e não foi classificado.',
      [{ role: 'user', content: 'A045 - Compras Necessárias' }],
      deps,
    );
    expect(out).toContain('Não consegui confirmar no banco');
    expect(out).toContain('Não marquei essa alteração como concluída');
    expect(calls).toEqual(['set:t45:c1']);
  });

  it('pede o codigo quando nao consegue identificar a solicitacao anterior', async () => {
    const { deps } = makeDeps();
    const out = await handleFinanceClassificationComplaint(
      'Ontem pedi para classificar e não foi classificado.',
      [],
      deps,
    );
    expect(out).toContain('Envie o código e a categoria');
  });

  it('falha fechada quando nao consegue consultar o banco', async () => {
    const { deps } = makeDeps();
    deps.getTransactionByReviewCode = async () => {
      throw new Error('banco fora');
    };
    const out = await handleFinanceClassificationComplaint(
      'Ontem pedi para classificar e não foi classificado.',
      [{ role: 'user', content: 'A045 - Compras Necessárias' }],
      deps,
    );
    expect(out).toContain('Não alterei nada');
  });
});
