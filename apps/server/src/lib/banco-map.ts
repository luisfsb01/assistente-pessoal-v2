/** Camada pura de mapeamento — sem I/O. */

export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // sempre positivo
  kind: 'expense' | 'income';
  providerCategory: string | null;
}

/** Detecta pagamentos de fatura na conta corrente (duplicariam as compras do cartão). */
const BILL_PAYMENT_RE = /pagamento.*fatura|pagto?\.?\s*fatura|fatura.*cart[aã]o/i;

/** Detecta créditos no cartão que são pagamento de fatura (não estorno). */
const CREDIT_PAYMENT_RE = /pagamento|pagto/i;

/**
 * Mapeia uma transação crua do provedor para BankTransaction.
 * Retorna null quando deve ser excluída (pagamento de fatura, pendente na
 * conta corrente, valor zero/NaN ou sem id).
 */
export function mapProviderTx(
  tx: Record<string, unknown>,
  accountType: 'BANK' | 'CREDIT',
): BankTransaction | null {
  const id = tx.id != null ? String(tx.id) : '';
  if (!id) return null;

  const date = String(tx.date ?? '').slice(0, 10);

  const raw = Number(tx.amount);
  if (isNaN(raw) || raw === 0) return null;
  const amount = Math.abs(raw);

  const description = String(tx.description ?? '');
  const status = String(tx.status ?? '');
  const type = String(tx.type ?? '');
  const providerCategory: string | null = tx.category != null ? String(tx.category) : null;

  if (accountType === 'BANK') {
    if (status !== 'POSTED') return null;
    if (BILL_PAYMENT_RE.test(description)) return null;
    if (providerCategory === 'Credit card payment') return null;
    const kind: 'expense' | 'income' = type === 'CREDIT' ? 'income' : 'expense';
    return { id, date, description, amount, kind, providerCategory };
  }

  // accountType === 'CREDIT' — aceita POSTED e PENDING (compra do dia pode estar PENDING)
  if (type === 'CREDIT') {
    if (CREDIT_PAYMENT_RE.test(description)) return null; // pagamento de fatura no cartão
    return { id, date, description, amount, kind: 'income', providerCategory }; // estorno
  }
  return { id, date, description, amount, kind: 'expense', providerCategory };
}
