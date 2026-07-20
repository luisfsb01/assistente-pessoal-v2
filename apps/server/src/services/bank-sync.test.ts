import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import {
  BankNotConfiguredError,
  syncBankTransactions,
  syncBankTransactionsToToday,
  type BankSyncDeps,
  type ManualBankSyncDeps,
} from './bank-sync.js';

const tx = (id: string, description: string): Transaction => ({
  id,
  occurred_on: '2026-07-12',
  description,
  amount: 10,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
});

describe('syncBankTransactions', () => {
  const transport: Category = {
    id: 'c1', name: 'Transporte', parent_id: null, monthly_target: null, counts: true, type: 'expense',
  };
  const leisure: Category = {
    id: 'c2', name: 'Lazer', parent_id: null, monthly_target: null, counts: true, type: 'expense',
  };

  function syncDeps(over: Partial<BankSyncDeps> = {}): BankSyncDeps {
    return {
      listBankTransactions: async () => [],
      upsertBankTransactions: async () => [],
      listUncategorizedBankTransactions: async () => [],
      listCategories: async () => [transport, leisure],
      applyRules: async () => new Map(),
      suggestTransactionCategory: async () => true,
      suggestCategoriesFor: async () => new Map(),
      ...over,
    };
  }

  it('aplica regras aprendidas e a IA como sugestões, sem confirmar automaticamente', async () => {
    const suggested: string[] = [];
    const rows = [tx('t1', 'UBER'), tx('t2', 'XYZ')];
    const deps: BankSyncDeps = {
      ...syncDeps(),
      listBankTransactions: async () => [
        { id: 'e1', date: '2026-07-12', description: 'UBER', amount: 10, kind: 'expense', providerCategory: null },
        { id: 'e2', date: '2026-07-12', description: 'XYZ', amount: 5, kind: 'expense', providerCategory: null },
      ],
      upsertBankTransactions: async () => rows,
      listUncategorizedBankTransactions: async () => rows,
      applyRules: async (items) => new Map(items.filter((i) => i.description === 'UBER').map((i) => [i.id, 'c1'])),
      suggestCategoriesFor: async (items) =>
        new Map(items.filter((item) => item.id === 't2').map((item) => [item.id, leisure])),
      suggestTransactionCategory: async (id, catId) => {
        suggested.push(`${id}:${catId}`);
        return true;
      },
    };
    const r = await syncBankTransactions('2026-07-12', '2026-07-12', deps);
    expect(r).toEqual({ imported: 2, autoClassified: 2 });
    expect(suggested).toEqual(['t1:c1', 't2:c2']);
  });

  it('retoma transações antigas sem categoria mesmo quando nenhuma nova foi importada', async () => {
    const prior = tx('prior', 'CINEMA');
    const suggested: string[] = [];
    const r = await syncBankTransactions('2026-07-12', '2026-07-18', syncDeps({
      listUncategorizedBankTransactions: async () => [prior],
      suggestCategoriesFor: async () => new Map([['prior', leisure]]),
      suggestTransactionCategory: async (id, categoryId) => {
        suggested.push(`${id}:${categoryId}`);
        return true;
      },
    }));
    expect(r).toEqual({ imported: 0, autoClassified: 1 });
    expect(suggested).toEqual(['prior:c2']);
  });

  it('falha da IA não perde a importação e deixa a transação para nova tentativa', async () => {
    const row = tx('t1', 'DESCONHECIDA');
    const r = await syncBankTransactions('2026-07-12', '2026-07-18', syncDeps({
      listBankTransactions: async () => [
        { id: 'e1', date: '2026-07-12', description: row.description, amount: 10, kind: 'expense', providerCategory: null },
      ],
      upsertBankTransactions: async () => [row],
      listUncategorizedBankTransactions: async () => [row],
      suggestCategoriesFor: async () => {
        throw new Error('IA fora');
      },
    }));
    expect(r).toEqual({ imported: 1, autoClassified: 0 });
  });
});

describe('syncBankTransactionsToToday', () => {
  function manualDeps(over: Partial<ManualBankSyncDeps> = {}): ManualBankSyncDeps {
    return {
      isBankConfigured: () => true,
      getLastImportedDate: async () => '2026-07-15',
      getLatestBankTransactionDate: async () => '2026-07-14',
      setLastImportedDate: async () => undefined,
      today: () => '2026-07-18',
      sync: async () => ({ imported: 2, autoClassified: 1 }),
      ...over,
    };
  }

  it('busca da última data registrada até hoje e só então avança o cursor', async () => {
    const calls: string[] = [];
    const result = await syncBankTransactionsToToday(manualDeps({
      sync: async (from, to) => {
        calls.push(`sync:${from}:${to}`);
        return { imported: 2, autoClassified: 1 };
      },
      setLastImportedDate: async (date) => void calls.push(`cursor:${date}`),
    }));

    expect(result).toEqual({ from: '2026-07-15', to: '2026-07-18', imported: 2, autoClassified: 1 });
    expect(calls).toEqual(['sync:2026-07-15:2026-07-18', 'cursor:2026-07-18']);
  });

  it('usa a transação bancária mais recente quando ainda não há cursor', async () => {
    const ranges: string[] = [];
    await syncBankTransactionsToToday(manualDeps({
      getLastImportedDate: async () => null,
      sync: async (from, to) => {
        ranges.push(`${from}:${to}`);
        return { imported: 0, autoClassified: 0 };
      },
    }));
    expect(ranges).toEqual(['2026-07-14:2026-07-18']);
  });

  it('não avança o cursor quando a importação falha', async () => {
    let cursorChanged = false;
    await expect(syncBankTransactionsToToday(manualDeps({
      sync: async () => { throw new Error('banco fora'); },
      setLastImportedDate: async () => { cursorChanged = true; },
    }))).rejects.toThrow('banco fora');
    expect(cursorChanged).toBe(false);
  });

  it('recusa a operação sem integração bancária configurada', async () => {
    await expect(syncBankTransactionsToToday(manualDeps({
      isBankConfigured: () => false,
    }))).rejects.toBeInstanceOf(BankNotConfiguredError);
  });
});
