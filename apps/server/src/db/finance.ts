import { nextReviewCode } from '../lib/review-code.js';
import { supabase } from './client.js';
import { getState, setState } from './state.js';
import { escapeLikePattern } from '../lib/postgrest.js';

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  monthly_target: number | null;
  counts: boolean;
  type: 'income' | 'expense' | 'investment';
}

export interface Transaction {
  id: string;
  occurred_on: string;
  description: string;
  amount: number;
  kind: 'expense' | 'income';
  source: 'bank' | 'manual';
  category_id: string | null;
  status: 'pending_review' | 'confirmed';
  review_code: string | null;
}

const TX_COLS = 'id, occurred_on, description, amount, kind, source, category_id, status, review_code';
const CAT_COLS = 'id, name, parent_id, monthly_target, counts, type';

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select(CAT_COLS).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getCategoryByName(name: string): Promise<Category | null> {
  const { data, error } = await supabase.from('categories').select(CAT_COLS).ilike('name', escapeLikePattern(name)).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createCategory(name: string, parentName?: string): Promise<Category | { error: string }> {
  let parentId: string | null = null;
  if (parentName) {
    const parent = await getCategoryByName(parentName);
    if (!parent) return { error: `categoria pai "${parentName}" não existe` };
    if (parent.parent_id) return { error: `"${parentName}" já é subcategoria — só 2 níveis são permitidos` };
    parentId = parent.id;
  }
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, parent_id: parentId })
    .select(CAT_COLS)
    .single();
  if (error) return { error: `não consegui criar (nome já existe?): ${error.message}` };
  return data;
}

export async function insertManualTransaction(opts: {
  occurredOn: string;
  description: string;
  amount: number;
  kind: 'expense' | 'income';
  categoryId: string | null;
}): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      occurred_on: opts.occurredOn,
      description: opts.description,
      amount: opts.amount,
      kind: opts.kind,
      source: 'manual',
      category_id: opts.categoryId,
      status: opts.categoryId ? 'confirmed' : 'pending_review',
    })
    .select(TX_COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Insere transações do banco com dedupe por external_id. Retorna apenas as novas. */
export async function upsertBankTransactions(
  txs: Array<{ externalId: string; occurredOn: string; description: string; amount: number; kind: 'expense' | 'income' }>,
): Promise<Transaction[]> {
  if (txs.length === 0) return [];
  const { data, error } = await supabase
    .from('transactions')
    .upsert(
      txs.map((t) => ({
        external_id: t.externalId,
        occurred_on: t.occurredOn,
        description: t.description,
        amount: t.amount,
        kind: t.kind,
        source: 'bank' as const,
      })),
      { onConflict: 'external_id', ignoreDuplicates: true },
    )
    .select(TX_COLS);
  if (error) throw error;
  return data ?? [];
}

export async function setTransactionCategory(txId: string, categoryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .update({ category_id: categoryId, status: 'confirmed' })
    .eq('id', txId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Define a categoria SUGERIDA sem confirmar (status continua pending_review). */
export async function suggestTransactionCategory(txId: string, categoryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .update({ category_id: categoryId })
    .eq('id', txId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function confirmTransaction(txId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .update({ status: 'confirmed' })
    .eq('id', txId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Transações num período (confirmadas e pendentes), com nome da categoria. */
export async function listTransactionsBetween(
  fromDate: string,
  toDate: string,
): Promise<Array<Transaction & { category_name: string | null }>> {
  const { data, error } = await supabase
    .from('transactions')
    .select(`${TX_COLS}, categories(name)`)
    .gte('occurred_on', fromDate)
    .lte('occurred_on', toDate)
    .order('occurred_on', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t: Record<string, unknown>) => ({
    ...(t as unknown as Transaction),
    category_name: (t.categories as { name: string } | null)?.name ?? null,
  }));
}

/** Todas as transações pendentes de revisão (mais recentes primeiro). */
export async function listPendingTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_COLS)
    .eq('status', 'pending_review')
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return data as Transaction[];
}

/** Transações bancárias que ainda precisam receber ao menos uma sugestão de categoria. */
export async function listUncategorizedBankTransactions(limit = 200): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_COLS)
    .eq('source', 'bank')
    .is('category_id', null)
    .order('occurred_on', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

/** Garante um review_code para a transação; retorna o código (existente ou novo). */
export async function ensureReviewCode(txId: string): Promise<string | null> {
  const { data: tx, error: e1 } = await supabase.from('transactions').select('review_code').eq('id', txId).maybeSingle();
  if (e1) throw e1;
  if (tx?.review_code) return tx.review_code;
  // formato letra+3 dígitos ordena como texto na ordem de emissão → o maior é o último emitido
  const { data: top, error: e2 } = await supabase
    .from('transactions')
    .select('review_code')
    .not('review_code', 'is', null)
    .order('review_code', { ascending: false })
    .limit(1);
  if (e2) throw e2;
  const code = nextReviewCode((top?.[0]?.review_code as string | null) ?? null);
  const { data, error } = await supabase
    .from('transactions')
    .update({ review_code: code })
    .eq('id', txId)
    .select('review_code')
    .single();
  if (error) throw error;
  return data.review_code;
}

export async function getTransactionByReviewCode(code: string): Promise<Transaction | null> {
  const { data, error } = await supabase.from('transactions').select(TX_COLS).ilike('review_code', escapeLikePattern(code)).maybeSingle();
  if (error) throw error;
  return data as Transaction | null;
}

export async function getTransactionById(id: string): Promise<Transaction | null> {
  const { data, error } = await supabase.from('transactions').select(TX_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Transaction | null;
}

/** Normaliza a descrição para servir de chave de regra: minúsculas, sem dígitos/pontuação, espaços colapsados. */
export function normalizePattern(desc: string): string {
  return desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (marcas combinantes do NFD)
    .replace(/[0-9]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aprende que uma descrição mapeia para uma categoria.
 *  Uma reclassificação manual mais recente substitui a regra anterior. */
export async function learnRule(description: string, categoryId: string): Promise<void> {
  const pattern = normalizePattern(description);
  if (!pattern) return;
  const { error } = await supabase
    .from('category_rules')
    .upsert(
      { pattern, category_id: categoryId, updated_at: new Date().toISOString() },
      { onConflict: 'pattern' },
    );
  if (error) throw error;
}

/** Para cada item {id, description}, retorna o category_id conhecido por regra. */
export async function applyRules(items: Array<{ id: string; description: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;
  const patterns = [...new Set(items.map((i) => normalizePattern(i.description)).filter(Boolean))];
  if (patterns.length === 0) return out;
  const { data, error } = await supabase.from('category_rules').select('pattern, category_id').in('pattern', patterns);
  if (error) throw error;
  const byPattern = new Map((data ?? []).map((r) => [r.pattern, r.category_id]));
  for (const it of items) {
    const cat = byPattern.get(normalizePattern(it.description));
    if (cat) out.set(it.id, cat);
  }
  return out;
}

export interface Commitment {
  id: string;
  description: string;
  amount: number | null;
  day_of_month: number;
  active: boolean;
}

const COMMIT_COLS = 'id, description, amount, day_of_month, active';

export async function createCommitment(description: string, dayOfMonth: number, amount?: number): Promise<Commitment> {
  const { data, error } = await supabase
    .from('financial_commitments')
    .insert({ description, day_of_month: dayOfMonth, amount: amount ?? null })
    .select(COMMIT_COLS)
    .single();
  if (error) throw error;
  return data;
}

export async function listCommitments(onlyActive = true): Promise<Commitment[]> {
  let q = supabase.from('financial_commitments').select(COMMIT_COLS).order('day_of_month');
  if (onlyActive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function deactivateCommitment(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('financial_commitments')
    .update({ active: false })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ── Estado do sync bancário (app_state) ─────────────────────────────────────

const LAST_IMPORT_KEY = 'finance_last_imported';

/** Última data importada com sucesso do Banco MCP. null = nunca importou. */
export async function getLastImportedDate(): Promise<string | null> {
  return getState<string>(LAST_IMPORT_KEY);
}

export async function setLastImportedDate(date: string): Promise<void> {
  await setState(LAST_IMPORT_KEY, date);
}

/** Data da transação bancária mais recente, usada como fallback em
 * instalações antigas que ainda não possuam `finance_last_imported`. */
export async function getLatestBankTransactionDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('occurred_on')
    .eq('source', 'bank')
    .order('occurred_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.occurred_on ?? null;
}

/** Despesas vindas do banco desde uma data (para o coletor de proatividade). */
export async function listRecentBankExpenses(sinceDate: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_COLS)
    .eq('source', 'bank')
    .eq('kind', 'expense')
    .gte('occurred_on', sinceDate)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return data as Transaction[];
}

/** Média e contagem das despesas de uma categoria desde uma data (base do "gasto atípico"). */
export async function categoryExpenseAvg(categoryId: string, sinceDate: string): Promise<{ avg: number; count: number }> {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('category_id', categoryId)
    .eq('kind', 'expense')
    .gte('occurred_on', sinceDate);
  if (error) throw error;
  const amounts = (data ?? []).map((r) => Number(r.amount));
  if (amounts.length === 0) return { avg: 0, count: 0 };
  return { avg: amounts.reduce((a, b) => a + b, 0) / amounts.length, count: amounts.length };
}
