import '../test-setup.js';
import { describe, expect, it, vi } from 'vitest';
import type { AgentOperation } from '../db/agent-operations.js';
import type { Category, Transaction } from '../db/finance.js';
import {
  confirmTransactionWithReceipt,
  reclassifyTransactionWithReceipt,
  type FinanceMcpDeps,
} from './finance-tools.js';

const transaction: Transaction = {
  id: 'tx-1',
  occurred_on: '2026-08-11',
  description: 'Mercado Central',
  amount: 120,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: 'A045',
};

const category: Category = {
  id: 'cat-1',
  name: 'Compras Necessárias',
  parent_id: null,
  monthly_target: null,
  counts: true,
  type: 'expense',
};

function operation(over: Partial<AgentOperation> = {}): AgentOperation {
  return {
    id: 'op-1',
    source: 'hermes',
    tool_name: 'finance_reclassify_transaction',
    idempotency_key: 'telegram:100:200',
    status: 'running',
    request: {
      code: 'A045',
      category_name: 'Compras Necessárias',
      idempotency_key: 'telegram:100:200',
    },
    result: null,
    error_code: null,
    started_at: '2026-08-12T10:00:00.000Z',
    completed_at: null,
    verified_at: null,
    ...over,
  };
}

function deps(over: Partial<FinanceMcpDeps> = {}): FinanceMcpDeps {
  return {
    listCategories: vi.fn(async () => [category]),
    getCategoryByName: vi.fn(async () => category),
    listTransactionsBetween: vi.fn(async () => []),
    listPendingTransactions: vi.fn(async () => []),
    getTransactionById: vi.fn(async () => ({
      ...transaction,
      category_id: category.id,
      status: 'confirmed',
    })),
    getTransactionByReviewCode: vi.fn(async () => transaction),
    reclassifyTransactions: vi.fn(async () => ({ updated: 1, learned: 1 })),
    syncBankTransactions: vi.fn(async () => ({
      from: '2026-08-11', to: '2026-08-12', imported: 0, autoClassified: 0,
    })),
    beginOperation: vi.fn(async () => ({ operation: operation(), created: true })),
    completeOperation: vi.fn(async (_id, result) => operation({
      status: 'succeeded',
      result,
      completed_at: '2026-08-12T10:00:01.000Z',
      verified_at: '2026-08-12T10:00:01.000Z',
    })),
    failOperation: vi.fn(async (_id, errorCode) => operation({
      status: 'failed', error_code: errorCode, completed_at: '2026-08-12T10:00:01.000Z',
    })),
    listOperations: vi.fn(async () => []),
    now: () => new Date('2026-08-12T12:00:00.000Z'),
    ...over,
  };
}

const input = {
  code: 'A045',
  category_name: 'Compras Necessárias',
  idempotency_key: 'telegram:100:200',
};

describe('reclassifyTransactionWithReceipt', () => {
  it('só confirma depois de reler categoria e status no banco', async () => {
    const fake = deps();
    const response = await reclassifyTransactionWithReceipt(input, fake);
    expect(fake.reclassifyTransactions).toHaveBeenCalledWith([{ id: 'tx-1', categoryId: 'cat-1' }]);
    expect(fake.getTransactionById).toHaveBeenCalledWith('tx-1');
    expect(response.structuredContent).toMatchObject({
      operation_id: 'op-1',
      status: 'succeeded',
      verified: true,
      category_name: 'Compras Necessárias',
      transaction_status: 'confirmed',
    });
  });

  it('não declara sucesso quando a releitura diverge', async () => {
    const fake = deps({
      getTransactionById: vi.fn(async () => ({ ...transaction, category_id: null })),
    });
    const response = await reclassifyTransactionWithReceipt(input, fake);
    expect(fake.failOperation).toHaveBeenCalledWith('op-1', 'verification_failed');
    expect(response.structuredContent).toMatchObject({
      status: 'failed', error_code: 'verification_failed',
    });
    expect(JSON.stringify(response.structuredContent)).not.toContain('"verified":true');
  });

  it('repete o recibo sem executar a mesma alteração novamente', async () => {
    const existing = operation({
      request: {
        idempotency_key: 'telegram:100:200',
        category_name: 'Compras Necessárias',
        code: 'A045',
      },
      status: 'succeeded',
      result: { ok: true, verified: true, category_name: category.name },
      completed_at: '2026-08-12T10:00:01.000Z',
      verified_at: '2026-08-12T10:00:01.000Z',
    });
    const fake = deps({ beginOperation: vi.fn(async () => ({ operation: existing, created: false })) });
    const response = await reclassifyTransactionWithReceipt(input, fake);
    expect(fake.reclassifyTransactions).not.toHaveBeenCalled();
    expect(response.structuredContent).toMatchObject({ replayed: true, verified: true });
  });
});

describe('confirmTransactionWithReceipt', () => {
  it('confirma a categoria sugerida pelo botão e relê o banco', async () => {
    const pendingWithCategory = { ...transaction, category_id: category.id };
    const fake = deps({
      getTransactionByReviewCode: vi.fn(async () => pendingWithCategory),
      beginOperation: vi.fn(async () => ({
        operation: operation({
          tool_name: 'finance_confirm_transaction',
          request: { code: 'A045', idempotency_key: 'telegram:confirm:A045' },
          idempotency_key: 'telegram:confirm:A045',
        }),
        created: true,
      })),
    });
    const response = await confirmTransactionWithReceipt({
      code: 'A045',
      idempotency_key: 'telegram:confirm:A045',
    }, fake);
    expect(fake.reclassifyTransactions).toHaveBeenCalledWith([{ id: 'tx-1', categoryId: 'cat-1' }]);
    expect(response.structuredContent).toMatchObject({
      status: 'succeeded', verified: true, transaction_status: 'confirmed', review_code: 'A045',
    });
  });
});
