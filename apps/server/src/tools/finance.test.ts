import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import { buildFinanceTools, type FinanceToolDeps } from './finance.js';

const cats: Category[] = [
  { id: 'r1', name: 'Casa', parent_id: null, monthly_target: 1000, counts: true, type: 'expense' },
  { id: 's1', name: 'Energia', parent_id: 'r1', monthly_target: null, counts: true, type: 'expense' },
  { id: 'r2', name: 'Salário', parent_id: null, monthly_target: null, counts: true, type: 'income' },
  { id: 'r3', name: 'Investimentos', parent_id: null, monthly_target: null, counts: true, type: 'investment' },
  { id: 'r4', name: 'Transferências', parent_id: null, monthly_target: null, counts: false, type: 'expense' },
];

const tx = (over: Partial<Transaction & { category_name: string | null }>): Transaction & { category_name: string | null } => ({
  id: 't1',
  occurred_on: '2026-07-10',
  description: 'X',
  amount: 100,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'confirmed',
  review_code: null,
  category_name: null,
  ...over,
});

function deps(over: Partial<FinanceToolDeps> = {}): FinanceToolDeps {
  return {
    listCategories: async () => cats,
    getCategoryByName: async (name) => cats.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null,
    createCategory: async (name) => ({ ...cats[0], id: 'novo', name }),
    insertManualTransaction: async (o) => tx({ id: 'novo', description: o.description, category_id: o.categoryId, status: o.categoryId ? 'confirmed' : 'pending_review' }),
    listTransactionsBetween: async () => [],
    setTransactionCategory: async () => true,
    confirmTransaction: async () => true,
    getTransactionByReviewCode: async () => null,
    getTransactionById: async () => tx({}),
    learnRule: async () => {},
    createCommitment: async (description, day_of_month, amount) => ({ id: 'c1', description, amount: amount ?? null, day_of_month, active: true }),
    listCommitments: async () => [],
    deactivateCommitment: async () => true,
    todayIso: () => '2026-07-13',
    ...over,
  };
}

async function run(tools: ReturnType<typeof buildFinanceTools>, name: string, input: unknown): Promise<string> {
  const t = tools[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('finance_add_transaction', () => {
  it('com categoria conhecida entra confirmada', async () => {
    const tools = buildFinanceTools(deps());
    const out = await run(tools, 'finance_add_transaction', { description: 'Feira', amount: 80, date: '2026-07-13', kind: 'expense', category_name: 'Casa' });
    expect(out).toContain('Feira');
    expect(out).not.toContain('pendente');
  });
  it('categoria desconhecida orienta a listar', async () => {
    const tools = buildFinanceTools(deps());
    const out = await run(tools, 'finance_add_transaction', { description: 'Feira', amount: 80, date: '2026-07-13', kind: 'expense', category_name: 'NãoExiste' });
    expect(out).toContain('não existe');
  });
});

describe('finance_month_summary', () => {
  it('agrega por categoria raiz, respeita counts=false e separa investimento', async () => {
    const txs = [
      tx({ id: 'a', amount: 200, category_id: 's1' }), // Casa (via sub Energia)
      tx({ id: 'b', amount: 300, category_id: 'r1' }), // Casa
      tx({ id: 'c', amount: 5000, kind: 'income', category_id: 'r2' }),
      tx({ id: 'd', amount: 1000, category_id: 'r3' }), // investimento — fora da despesa
      tx({ id: 'e', amount: 999, category_id: 'r4' }), // counts=false — fora de tudo
      tx({ id: 'f', amount: 50, category_id: null, status: 'pending_review' }), // sem categoria conta como despesa
    ];
    const tools = buildFinanceTools(deps({ listTransactionsBetween: async () => txs }));
    const out = JSON.parse(await run(tools, 'finance_month_summary', {}));
    expect(out.month).toBe('2026-07');
    expect(out.income).toBe(5000);
    expect(out.expense).toBe(550); // 200 + 300 + 50
    expect(out.invested).toBe(1000);
    expect(out.pending_review).toBe(1);
    const casa = out.by_category.find((c: { category: string }) => c.category === 'Casa');
    expect(casa).toMatchObject({ spent: 500, target: 1000 });
  });
});

describe('finance_classify_transaction', () => {
  it('resolve por código, classifica e aprende a regra', async () => {
    const learned: string[] = [];
    const d = deps({
      getTransactionByReviewCode: async (code) => (code === 'A001' ? tx({ id: 'tz', description: 'CEMIG' }) : null),
      learnRule: async (desc, catId) => {
        learned.push(`${desc}:${catId}`);
      },
    });
    const tools = buildFinanceTools(d);
    const out = await run(tools, 'finance_classify_transaction', { code: 'A001', category_name: 'Energia' });
    expect(out).toContain('Energia');
    expect(learned).toEqual(['CEMIG:s1']);
  });
  it('código desconhecido explica', async () => {
    const tools = buildFinanceTools(deps());
    const out = await run(tools, 'finance_classify_transaction', { code: 'Z999', category_name: 'Casa' });
    expect(out).toContain('Z999');
  });
});

describe('finance_confirm_transaction', () => {
  it('confirma pela categoria já sugerida e aprende a regra', async () => {
    const learned: string[] = [];
    const d = deps({
      getTransactionByReviewCode: async () => tx({ id: 'tz', description: 'CEMIG', category_id: 's1', status: 'pending_review' }),
      learnRule: async (desc, catId) => {
        learned.push(`${desc}:${catId}`);
      },
    });
    const tools = buildFinanceTools(d);
    const out = await run(tools, 'finance_confirm_transaction', { code: 'A001' });
    expect(out.toLowerCase()).toContain('confirmad');
    expect(learned).toEqual(['CEMIG:s1']);
  });
});

describe('erros de infra viram FAIL em PT-BR', () => {
  it('finance_list_transactions com repo quebrado', async () => {
    const tools = buildFinanceTools(deps({ listTransactionsBetween: async () => { throw new Error('boom'); } }));
    const out = await run(tools, 'finance_list_transactions', { from_date: '2026-07-01', to_date: '2026-07-13' });
    expect(out).toContain('Não consegui');
  });
});
