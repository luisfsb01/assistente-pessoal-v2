import {
  McpServer,
  fromJsonSchema,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import {
  getCategoryByName,
  getTransactionById,
  getTransactionByReviewCode,
  listCategories,
  listPendingTransactions,
  listTransactionsBetween,
  type Category,
  type Transaction,
} from '../db/finance.js';
import {
  beginAgentOperation,
  completeAgentOperation,
  failAgentOperation,
  listAgentOperations,
  type AgentOperation,
} from '../db/agent-operations.js';
import { syncBankTransactionsToToday } from '../services/bank-sync.js';
import { reclassifyTransactions } from '../services/transaction-reclassification.js';
import { registerRoutineMcpTools } from './routine-tools.js';
import { registerKnowledgeMcpTools } from './knowledge-tools.js';
import { registerTravelMcpTools } from './travel-tools.js';

const datePattern = '^\\d{4}-\\d{2}-\\d{2}$';

const noInput = fromJsonSchema<Record<string, never>>({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

const listTransactionsInput = fromJsonSchema<{
  from_date?: string;
  to_date?: string;
  status?: 'all' | 'pending_review' | 'confirmed';
  limit?: number;
}>({
  type: 'object',
  properties: {
    from_date: { type: 'string', pattern: datePattern, description: 'Data inicial YYYY-MM-DD.' },
    to_date: { type: 'string', pattern: datePattern, description: 'Data final YYYY-MM-DD.' },
    status: { type: 'string', enum: ['all', 'pending_review', 'confirmed'], default: 'all' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
  },
  additionalProperties: false,
});

const transactionInput = fromJsonSchema<{ code?: string; transaction_id?: string }>({
  type: 'object',
  properties: {
    code: { type: 'string', minLength: 2, maxLength: 10, description: 'Código de revisão, por exemplo A045.' },
    transaction_id: { type: 'string', minLength: 1, maxLength: 100 },
  },
  anyOf: [{ required: ['code'] }, { required: ['transaction_id'] }],
  additionalProperties: false,
});

const reclassifyInput = fromJsonSchema<{
  code?: string;
  transaction_id?: string;
  category_name: string;
  idempotency_key: string;
}>({
  type: 'object',
  properties: {
    code: { type: 'string', minLength: 2, maxLength: 10, description: 'Código de revisão, por exemplo A045.' },
    transaction_id: { type: 'string', minLength: 1, maxLength: 100 },
    category_name: { type: 'string', minLength: 1, maxLength: 160 },
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 120,
      pattern: '^[A-Za-z0-9._:-]+$',
      description: 'Identificador único e estável desta solicitação. Reutilize-o ao tentar novamente.',
    },
  },
  required: ['category_name', 'idempotency_key'],
  anyOf: [{ required: ['code'] }, { required: ['transaction_id'] }],
  additionalProperties: false,
});

const confirmInput = fromJsonSchema<{
  code?: string;
  transaction_id?: string;
  idempotency_key: string;
}>({
  type: 'object',
  properties: {
    code: { type: 'string', minLength: 2, maxLength: 10, description: 'Código de revisão, por exemplo A045.' },
    transaction_id: { type: 'string', minLength: 1, maxLength: 100 },
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 120,
      pattern: '^[A-Za-z0-9._:-]+$',
    },
  },
  required: ['idempotency_key'],
  anyOf: [{ required: ['code'] }, { required: ['transaction_id'] }],
  additionalProperties: false,
});

const syncInput = fromJsonSchema<{ idempotency_key: string }>({
  type: 'object',
  properties: {
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 120,
      pattern: '^[A-Za-z0-9._:-]+$',
    },
  },
  required: ['idempotency_key'],
  additionalProperties: false,
});

const operationListInput = fromJsonSchema<{ limit?: number }>({
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
  additionalProperties: false,
});

export type FinanceMcpDeps = {
  listCategories: () => Promise<Category[]>;
  getCategoryByName: (name: string) => Promise<Category | null>;
  listTransactionsBetween: typeof listTransactionsBetween;
  listPendingTransactions: () => Promise<Transaction[]>;
  getTransactionById: (id: string) => Promise<Transaction | null>;
  getTransactionByReviewCode: (code: string) => Promise<Transaction | null>;
  reclassifyTransactions: typeof reclassifyTransactions;
  syncBankTransactions: typeof syncBankTransactionsToToday;
  beginOperation: typeof beginAgentOperation;
  completeOperation: typeof completeAgentOperation;
  failOperation: typeof failAgentOperation;
  listOperations: (limit?: number) => Promise<AgentOperation[]>;
  now: () => Date;
};

const defaultDeps: FinanceMcpDeps = {
  listCategories,
  getCategoryByName,
  listTransactionsBetween,
  listPendingTransactions,
  getTransactionById,
  getTransactionByReviewCode,
  reclassifyTransactions,
  syncBankTransactions: syncBankTransactionsToToday,
  beginOperation: beginAgentOperation,
  completeOperation: completeAgentOperation,
  failOperation: failAgentOperation,
  listOperations: listAgentOperations,
  now: () => new Date(),
};

function result(value: Record<string, unknown>, message?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message ?? JSON.stringify(value) }],
    structuredContent: value,
  };
}

function errorResult(code: string, message: string): CallToolResult {
  return result({ ok: false, error_code: code, message }, message);
}

function operationReceipt(operation: AgentOperation, replayed = false): Record<string, unknown> {
  return {
    operation_id: operation.id,
    idempotency_key: operation.idempotency_key,
    status: operation.status,
    verified_at: operation.verified_at,
    replayed,
    ...(operation.result ?? {}),
    ...(operation.error_code ? { error_code: operation.error_code } : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function resolveTransaction(
  input: { code?: string; transaction_id?: string },
  deps: FinanceMcpDeps,
): Promise<Transaction | null> {
  if (input.transaction_id) return deps.getTransactionById(input.transaction_id);
  if (input.code) return deps.getTransactionByReviewCode(input.code.trim().toUpperCase());
  return null;
}

export async function reclassifyTransactionWithReceipt(
  input: { code?: string; transaction_id?: string; category_name: string; idempotency_key: string },
  deps: FinanceMcpDeps,
): Promise<CallToolResult> {
  const request = { ...input } as Record<string, unknown>;
  const begun = await deps.beginOperation({
    toolName: 'finance_reclassify_transaction',
    idempotencyKey: input.idempotency_key,
    request,
  });
  if (!begun.created) {
    if (
      begun.operation.tool_name !== 'finance_reclassify_transaction' ||
      canonicalJson(begun.operation.request) !== canonicalJson(request)
    ) {
      return errorResult('idempotency_conflict', 'Esse identificador já foi usado para outra solicitação.');
    }
    if (begun.operation.status !== 'running') return result(operationReceipt(begun.operation, true));
    return errorResult('operation_in_progress', 'Essa solicitação ainda está em execução.');
  }

  try {
    const [transaction, category] = await Promise.all([
      resolveTransaction(input, deps),
      deps.getCategoryByName(input.category_name.trim()),
    ]);
    if (!transaction) {
      const failed = await deps.failOperation(begun.operation.id, 'transaction_not_found');
      return result(operationReceipt(failed), 'Transação não encontrada; nada foi alterado.');
    }
    if (!category) {
      const failed = await deps.failOperation(begun.operation.id, 'category_not_found');
      return result(operationReceipt(failed), 'Categoria não encontrada; nada foi alterado.');
    }

    await deps.reclassifyTransactions([{ id: transaction.id, categoryId: category.id }]);
    const saved = await deps.getTransactionById(transaction.id);
    const verified = saved?.category_id === category.id && saved.status === 'confirmed';
    if (!verified) {
      const failed = await deps.failOperation(begun.operation.id, 'verification_failed');
      return result(operationReceipt(failed), 'A alteração não foi confirmada no banco.');
    }

    const completed = await deps.completeOperation(begun.operation.id, {
      ok: true,
      verified: true,
      transaction_id: transaction.id,
      review_code: saved.review_code,
      category_id: category.id,
      category_name: category.name,
      transaction_status: saved.status,
    });
    return result(
      operationReceipt(completed),
      `Reclassificação confirmada no banco: ${saved.review_code ?? saved.id} como ${category.name}.`,
    );
  } catch (error) {
    console.error('[mcp] finance_reclassify_transaction falhou:', error);
    const failed = await deps.failOperation(begun.operation.id, 'internal_error');
    return result(operationReceipt(failed), 'Não consegui concluir e verificar a reclassificação.');
  }
}

export async function confirmTransactionWithReceipt(
  input: { code?: string; transaction_id?: string; idempotency_key: string },
  deps: FinanceMcpDeps,
): Promise<CallToolResult> {
  const request = { ...input } as Record<string, unknown>;
  const begun = await deps.beginOperation({
    toolName: 'finance_confirm_transaction',
    idempotencyKey: input.idempotency_key,
    request,
  });
  if (!begun.created) {
    if (
      begun.operation.tool_name !== 'finance_confirm_transaction' ||
      canonicalJson(begun.operation.request) !== canonicalJson(request)
    ) {
      return errorResult('idempotency_conflict', 'Esse identificador já foi usado para outra solicitação.');
    }
    if (begun.operation.status !== 'running') return result(operationReceipt(begun.operation, true));
    return errorResult('operation_in_progress', 'Essa confirmação ainda está em execução.');
  }

  try {
    const transaction = await resolveTransaction(input, deps);
    if (!transaction) {
      const failed = await deps.failOperation(begun.operation.id, 'transaction_not_found');
      return result(operationReceipt(failed), 'Transação não encontrada; nada foi alterado.');
    }
    if (!transaction.category_id) {
      const failed = await deps.failOperation(begun.operation.id, 'category_missing');
      return result(operationReceipt(failed), 'A transação ainda não tem categoria para confirmar.');
    }

    await deps.reclassifyTransactions([{ id: transaction.id, categoryId: transaction.category_id }]);
    const saved = await deps.getTransactionById(transaction.id);
    const verified = saved?.category_id === transaction.category_id && saved.status === 'confirmed';
    if (!verified) {
      const failed = await deps.failOperation(begun.operation.id, 'verification_failed');
      return result(operationReceipt(failed), 'A confirmação não foi gravada no banco.');
    }
    const categories = await deps.listCategories();
    const categoryName = categories.find((category) => category.id === saved.category_id)?.name ?? null;
    const completed = await deps.completeOperation(begun.operation.id, {
      ok: true,
      verified: true,
      transaction_id: saved.id,
      review_code: saved.review_code,
      category_id: saved.category_id,
      category_name: categoryName,
      transaction_status: saved.status,
    });
    return result(
      operationReceipt(completed),
      `Confirmação conferida no banco: ${saved.review_code ?? saved.id}${categoryName ? ` como ${categoryName}` : ''}.`,
    );
  } catch (error) {
    console.error('[mcp] finance_confirm_transaction falhou:', error);
    const failed = await deps.failOperation(begun.operation.id, 'internal_error');
    return result(operationReceipt(failed), 'Não consegui concluir e verificar a confirmação.');
  }
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createFinanceMcpServer(
  deps: FinanceMcpDeps = defaultDeps,
): McpServer {
  const server = new McpServer({ name: 'assistente-pessoal-v2', version: '1.0.0' });

  server.registerTool(
    'finance_list_categories',
    {
      title: 'Listar categorias financeiras',
      description: 'Lista categorias válidas antes de classificar uma transação.',
      inputSchema: noInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => result({ ok: true, categories: await deps.listCategories() }),
  );

  server.registerTool(
    'finance_list_transactions',
    {
      title: 'Consultar transações',
      description: 'Consulta transações e seus estados reais no banco. Use para localizar códigos e auditar classificações.',
      inputSchema: listTransactionsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ from_date, to_date, status = 'all', limit = 30 }) => {
      const transactions = status === 'pending_review' && !from_date && !to_date
        ? await deps.listPendingTransactions()
        : await deps.listTransactionsBetween(from_date ?? '2000-01-01', to_date ?? todayIso(deps.now()));
      const filtered = status === 'all' ? transactions : transactions.filter((tx) => tx.status === status);
      const latest = [...filtered]
        .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
        .slice(0, limit);
      return result({ ok: true, transactions: latest });
    },
  );

  server.registerTool(
    'finance_get_transaction',
    {
      title: 'Conferir uma transação',
      description: 'Relê uma transação diretamente do banco por código ou ID e retorna categoria e status atuais.',
      inputSchema: transactionInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const transaction = await resolveTransaction(input, deps);
      if (!transaction) return errorResult('transaction_not_found', 'Transação não encontrada.');
      const categories = await deps.listCategories();
      const categoryName = categories.find((category) => category.id === transaction.category_id)?.name ?? null;
      return result({ ok: true, transaction: { ...transaction, category_name: categoryName } });
    },
  );

  server.registerTool(
    'finance_confirm_transaction',
    {
      title: 'Confirmar categoria sugerida',
      description: 'Confirma a categoria já sugerida, aprende a regra e relê o banco. Use ao receber o botão Confirmar.',
      inputSchema: confirmInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => confirmTransactionWithReceipt(input, deps),
  );

  server.registerTool(
    'finance_reclassify_transaction',
    {
      title: 'Reclassificar e verificar uma transação',
      description:
        'Altera a categoria, confirma o status, aprende a correção e relê o banco. Só reporte sucesso quando verified=true.',
      inputSchema: reclassifyInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => reclassifyTransactionWithReceipt(input, deps),
  );

  server.registerTool(
    'finance_sync_bank',
    {
      title: 'Sincronizar banco',
      description: 'Busca novas transações do banco com idempotência e retorna um recibo da operação.',
      inputSchema: syncInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ idempotency_key }) => {
      const request = { idempotency_key };
      const begun = await deps.beginOperation({ toolName: 'finance_sync_bank', idempotencyKey: idempotency_key, request });
      if (!begun.created) {
        if (begun.operation.tool_name !== 'finance_sync_bank') return errorResult('idempotency_conflict', 'Identificador já utilizado.');
        if (begun.operation.status !== 'running') return result(operationReceipt(begun.operation, true));
        return errorResult('operation_in_progress', 'Essa sincronização ainda está em execução.');
      }
      try {
        const sync = await deps.syncBankTransactions();
        const completed = await deps.completeOperation(begun.operation.id, { ok: true, verified: true, ...sync });
        return result(operationReceipt(completed));
      } catch (error) {
        console.error('[mcp] finance_sync_bank falhou:', error);
        const failed = await deps.failOperation(begun.operation.id, 'bank_sync_failed');
        return result(operationReceipt(failed), 'A sincronização bancária falhou.');
      }
    },
  );

  server.registerTool(
    'operations_list_receipts',
    {
      title: 'Consultar recibos de operações',
      description: 'Lista as operações recentes do Hermes para conferir o que foi solicitado, concluído, verificado ou rejeitado.',
      inputSchema: operationListInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit = 20 }) => result({ ok: true, operations: await deps.listOperations(limit) }),
  );

  registerRoutineMcpTools(server);
  registerKnowledgeMcpTools(server);
  registerTravelMcpTools(server);

  return server;
}
