import { describe, expect, it } from 'vitest';
import { mapProviderTx } from './banco-map.js';

const base = { id: 'tx1', date: '2026-07-12T00:00:00Z', description: 'UBER TRIP', amount: -24.9, status: 'POSTED', type: 'DEBIT', category: null };

describe('mapProviderTx BANK', () => {
  it('DEBIT vira expense com valor positivo e data cortada', () => {
    const t = mapProviderTx(base, 'BANK');
    expect(t).toMatchObject({ id: 'tx1', date: '2026-07-12', amount: 24.9, kind: 'expense' });
  });
  it('CREDIT vira income', () => {
    expect(mapProviderTx({ ...base, type: 'CREDIT', amount: 100 }, 'BANK')?.kind).toBe('income');
  });
  it('exclui não-POSTED, pagamento de fatura e categoria Credit card payment', () => {
    expect(mapProviderTx({ ...base, status: 'PENDING' }, 'BANK')).toBeNull();
    expect(mapProviderTx({ ...base, description: 'PAGAMENTO FATURA CARTAO' }, 'BANK')).toBeNull();
    expect(mapProviderTx({ ...base, category: 'Credit card payment' }, 'BANK')).toBeNull();
  });
  it('exclui valor zero/NaN e id vazio', () => {
    expect(mapProviderTx({ ...base, amount: 0 }, 'BANK')).toBeNull();
    expect(mapProviderTx({ ...base, amount: 'x' }, 'BANK')).toBeNull();
    expect(mapProviderTx({ ...base, id: '' }, 'BANK')).toBeNull();
  });
});

describe('mapProviderTx CREDIT', () => {
  it('DEBIT (compra) vira expense mesmo PENDING', () => {
    expect(mapProviderTx({ ...base, status: 'PENDING' }, 'CREDIT')?.kind).toBe('expense');
  });
  it('CREDIT que é pagamento é excluído; estorno vira income', () => {
    expect(mapProviderTx({ ...base, type: 'CREDIT', description: 'PAGAMENTO RECEBIDO' }, 'CREDIT')).toBeNull();
    expect(mapProviderTx({ ...base, type: 'CREDIT', description: 'ESTORNO COMPRA' }, 'CREDIT')?.kind).toBe('income');
  });
});
