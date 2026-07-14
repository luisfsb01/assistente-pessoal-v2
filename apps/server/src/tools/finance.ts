import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  confirmTransaction,
  createCategory,
  createCommitment,
  deactivateCommitment,
  getCategoryByName,
  getTransactionById,
  getTransactionByReviewCode,
  insertManualTransaction,
  learnRule,
  listCategories,
  listCommitments,
  listTransactionsBetween,
  setTransactionCategory,
  type Transaction,
} from '../db/finance.js';
import { rootCategoryOf } from '../lib/category-tree.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

export type FinanceToolDeps = {
  listCategories: typeof listCategories;
  getCategoryByName: typeof getCategoryByName;
  createCategory: typeof createCategory;
  insertManualTransaction: typeof insertManualTransaction;
  listTransactionsBetween: typeof listTransactionsBetween;
  setTransactionCategory: typeof setTransactionCategory;
  confirmTransaction: typeof confirmTransaction;
  getTransactionByReviewCode: typeof getTransactionByReviewCode;
  getTransactionById: typeof getTransactionById;
  learnRule: typeof learnRule;
  createCommitment: typeof createCommitment;
  listCommitments: typeof listCommitments;
  deactivateCommitment: typeof deactivateCommitment;
  todayIso: () => string;
};

const defaultDeps: FinanceToolDeps = {
  listCategories,
  getCategoryByName,
  createCategory,
  insertManualTransaction,
  listTransactionsBetween,
  setTransactionCategory,
  confirmTransaction,
  getTransactionByReviewCode,
  getTransactionById,
  learnRule,
  createCommitment,
  listCommitments,
  deactivateCommitment,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FAIL = 'Não consegui acessar as finanças agora. Tenta de novo em instantes.';

/** Último dia do mês YYYY-MM em YYYY-MM-DD. */
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Resolve uma transação por código de revisão (A001) ou id. */
async function resolveTx(
  deps: FinanceToolDeps,
  code?: string,
  transactionId?: string,
): Promise<Transaction | string> {
  if (code) {
    const tx = await deps.getTransactionByReviewCode(code);
    return tx ?? `Nenhuma transação com o código ${code}.`;
  }
  if (transactionId) {
    const tx = await deps.getTransactionById(transactionId);
    return tx ?? 'Transação não encontrada.';
  }
  return 'Informe o código (ex.: A001) ou o id da transação.';
}

export function buildFinanceTools(deps: FinanceToolDeps = defaultDeps): ToolSet {
  return {
    finance_add_transaction: tool({
      description:
        'Registra um gasto ou receita manual (ex.: dinheiro vivo, pix que não é do banco conectado). Com category_name entra confirmada; sem, fica pendente de classificação.',
      inputSchema: z.object({
        description: z.string(),
        amount: z.number().positive().describe('Valor em reais'),
        date: dateSchema,
        kind: z.enum(['expense', 'income']).default('expense'),
        category_name: z.string().optional(),
      }),
      execute: async ({ description, amount, date, kind, category_name }) => {
        try {
          let categoryId: string | null = null;
          if (category_name) {
            const cat = await deps.getCategoryByName(category_name);
            if (!cat) return `A categoria "${category_name}" não existe — use finance_list_categories para ver as opções.`;
            categoryId = cat.id;
          }
          const t = await deps.insertManualTransaction({ occurredOn: date, description, amount, kind, categoryId });
          return t.status === 'confirmed'
            ? `Registrado: ${description}.`
            : `Registrado: ${description} (ficou pendente de categoria).`;
        } catch {
          return FAIL;
        }
      },
    }),

    finance_list_transactions: tool({
      description: 'Lista transações num período (gastos e receitas), com categoria, status e código de revisão.',
      inputSchema: z.object({ from_date: dateSchema, to_date: dateSchema }),
      execute: async ({ from_date, to_date }) => {
        try {
          const txs = await deps.listTransactionsBetween(from_date, to_date);
          if (txs.length === 0) return 'Nenhuma transação no período.';
          return JSON.stringify(
            txs.map((t) => ({
              id: t.id,
              date: t.occurred_on,
              description: t.description,
              amount: t.amount,
              kind: t.kind,
              category: t.category_name,
              status: t.status,
              code: t.review_code,
            })),
          );
        } catch {
          return FAIL;
        }
      },
    }),

    finance_month_summary: tool({
      description:
        'Resumo financeiro de um mês: receitas, despesas, investido, saldo e gasto por categoria raiz comparado com a meta. Sem month usa o mês atual.',
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      execute: async ({ month }) => {
        try {
          const m = month ?? deps.todayIso().slice(0, 7);
          const [txs, cats] = await Promise.all([
            deps.listTransactionsBetween(`${m}-01`, lastDayOfMonth(m)),
            deps.listCategories(),
          ]);
          let income = 0;
          let expense = 0;
          let invested = 0;
          let pendingReview = 0;
          const spentByRoot = new Map<string, number>();
          for (const t of txs) {
            if (t.status === 'pending_review') pendingReview++;
            const root = t.category_id ? rootCategoryOf(t.category_id, cats) : null;
            if (root && root.counts === false) continue; // transferências etc. não contam
            const amount = Number(t.amount);
            if (root?.type === 'investment') {
              invested += amount;
              continue;
            }
            if (t.kind === 'income') {
              income += amount;
            } else {
              expense += amount;
              const key = root?.name ?? 'Sem categoria';
              spentByRoot.set(key, (spentByRoot.get(key) ?? 0) + amount);
            }
          }
          const targetByName = new Map(
            cats.filter((c) => !c.parent_id && c.monthly_target != null).map((c) => [c.name, Number(c.monthly_target)]),
          );
          const byCategory = [...spentByRoot.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([category, spent]) => ({ category, spent, target: targetByName.get(category) ?? null }));
          return JSON.stringify({
            month: m,
            income,
            expense,
            invested,
            balance: income - expense - invested,
            pending_review: pendingReview,
            by_category: byCategory,
          });
        } catch {
          return FAIL;
        }
      },
    }),

    finance_list_categories: tool({
      description: 'Lista as categorias de gastos (com metas mensais quando houver) e suas subcategorias.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const cats = await deps.listCategories();
          const roots = cats.filter((c) => !c.parent_id);
          const childrenByParent = new Map<string, string[]>();
          for (const c of cats) {
            if (!c.parent_id) continue;
            const list = childrenByParent.get(c.parent_id) ?? [];
            list.push(c.name);
            childrenByParent.set(c.parent_id, list);
          }
          return JSON.stringify(
            roots.map((r) => ({
              name: r.name,
              type: r.type,
              monthly_target: r.monthly_target,
              subcategories: childrenByParent.get(r.id) ?? [],
            })),
          );
        } catch {
          return FAIL;
        }
      },
    }),

    finance_create_category: tool({
      description: 'Cria uma categoria (sem parent) ou subcategoria (com parent_name, ex.: Energia dentro de Casa). Máximo 2 níveis.',
      inputSchema: z.object({ name: z.string(), parent_name: z.string().optional() }),
      execute: async ({ name, parent_name }) => {
        try {
          const r = await deps.createCategory(name, parent_name);
          if ('error' in r) return `Não deu: ${r.error}.`;
          return `Categoria "${r.name}" criada${parent_name ? ` dentro de ${parent_name}` : ''}.`;
        } catch {
          return FAIL;
        }
      },
    }),

    finance_classify_transaction: tool({
      description:
        'Define/corrige a categoria de uma transação e confirma. Aceita o código curto (A001) mostrado na revisão diária OU o id de finance_list_transactions. Aprende a regra para as próximas.',
      inputSchema: z.object({
        code: z.string().optional().describe('código curto de revisão, ex.: A001'),
        transaction_id: z.string().optional().describe('id vindo de finance_list_transactions'),
        category_name: z.string(),
      }),
      execute: async ({ code, transaction_id, category_name }) => {
        try {
          const tx = await resolveTx(deps, code, transaction_id);
          if (typeof tx === 'string') return tx;
          const cat = await deps.getCategoryByName(category_name);
          if (!cat) return `A categoria "${category_name}" não existe — use finance_list_categories para ver as opções.`;
          const ok = await deps.setTransactionCategory(tx.id, cat.id);
          if (!ok) return 'Transação não encontrada.';
          try {
            await deps.learnRule(tx.description, cat.id);
          } catch (err) {
            console.error('finance_classify_transaction: learnRule falhou:', err);
          }
          return `Classificado como ${cat.name}.`;
        } catch {
          return FAIL;
        }
      },
    }),

    finance_confirm_transaction: tool({
      description:
        'Confirma uma transação pendente na categoria já sugerida (sem trocar). Aceita código curto (A001) ou id. Aprende a regra.',
      inputSchema: z.object({
        code: z.string().optional().describe('código curto de revisão, ex.: A001'),
        transaction_id: z.string().optional(),
      }),
      execute: async ({ code, transaction_id }) => {
        try {
          const tx = await resolveTx(deps, code, transaction_id);
          if (typeof tx === 'string') return tx;
          if (!tx.category_id) return 'Essa transação ainda não tem categoria sugerida — use finance_classify_transaction com a categoria.';
          const ok = await deps.confirmTransaction(tx.id);
          if (!ok) return 'Transação não encontrada.';
          try {
            await deps.learnRule(tx.description, tx.category_id);
          } catch (err) {
            console.error('finance_confirm_transaction: learnRule falhou:', err);
          }
          return 'Confirmada. ✅';
        } catch {
          return FAIL;
        }
      },
    }),

    finance_add_commitment: tool({
      description: 'Cadastra um compromisso financeiro mensal (conta que vence todo mês no dia X, 1-28). Valor opcional.',
      inputSchema: z.object({
        description: z.string(),
        day_of_month: z.number().int().min(1).max(28),
        amount: z.number().positive().optional(),
      }),
      execute: async ({ description, day_of_month, amount }) => {
        try {
          const c = await deps.createCommitment(description, day_of_month, amount);
          return `Compromisso "${c.description}" cadastrado para todo dia ${c.day_of_month}.`;
        } catch {
          return FAIL;
        }
      },
    }),

    finance_list_commitments: tool({
      description: 'Lista os compromissos financeiros mensais ativos (com id, dia do mês e valor).',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const list = await deps.listCommitments();
          if (list.length === 0) return 'Nenhum compromisso mensal cadastrado.';
          return JSON.stringify(list.map((c) => ({ id: c.id, description: c.description, day: c.day_of_month, amount: c.amount })));
        } catch {
          return FAIL;
        }
      },
    }),

    finance_remove_commitment: tool({
      description: 'Desativa um compromisso financeiro mensal (id vem de finance_list_commitments).',
      inputSchema: z.object({ commitment_id: z.string() }),
      execute: async ({ commitment_id }) => {
        try {
          const ok = await deps.deactivateCommitment(commitment_id);
          return ok ? 'Compromisso desativado.' : 'Compromisso não encontrado.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
