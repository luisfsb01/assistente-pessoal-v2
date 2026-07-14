# Fase 3 — Finanças no chat: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finanças completas no chat — importação diária do Banco MCP, gasto manual, categorização com aprendizado de regras, metas por categoria, compromissos mensais e revisão diária com botões de confirmação.

**Architecture:** Porta o subsistema financeiro da v1 (que já roda contra as MESMAS tabelas do Supabase que mantivemos: `categories`, `transactions`, `category_rules`, `financial_commitments`) adaptado às convenções da v2: tool factories com deps injetáveis, todas as chamadas de LLM via `agent/models.ts` (guarda de custo), estado de sync em `app_state`, estilo de conversa da Fase 2. A revisão diária roda por cron às 08:00 e envia ao privado do Luis uma mensagem por transação pendente com botão ✅ (único uso de botões, conforme spec).

**Tech Stack:** Node 22, TypeScript ESM NodeNext, grammY (InlineKeyboard + callback_query), Vercel AI SDK v5 (`generateObject` via `generateAgentObject`), zod, Supabase PostgREST, node-cron, vitest.

## Global Constraints

- Imports relativos SEMPRE terminam em `.js` (ESM NodeNext).
- Código com ponto e vírgula, aspas simples, como o restante da v2 (a v1 não usa `;` — ao portar, adapte).
- Toda chamada de LLM passa por `generateAgentText`/`generateAgentObject` de `apps/server/src/agent/models.ts` (grava `llm_usage` e respeita a guarda de R$ 50/mês). NUNCA chame `generateObject`/`generateText` da lib `ai` direto em código de produção.
- Categorização usa o modelo DEFAULT (gpt-5-mini), nunca o forte.
- Banco MCP é **read-only** — nenhuma tool de escrita no banco do Luis.
- Mensagens ao usuário em PT-BR; valores como `R$ 1.234,56` (`formatBrl`); datas curtas `dd/mm`; UUIDs nunca aparecem para o usuário (códigos curtos de revisão A001 PODEM aparecer — existem para isso).
- Tools seguem o padrão de `apps/server/src/tools/tasks.ts`: factory `buildXxxTools(deps?)` com deps injetáveis default, `try/catch` retornando mensagem `FAIL` em PT-BR, retornos como string ou `JSON.stringify`.
- Testes: vitest na raiz do repo (`npx vitest run <caminho>`); testes que precisam de env importam `'../test-setup.js'` como PRIMEIRO import; use fakes/deps injetadas, nunca rede.
- Tabelas financeiras JÁ EXISTEM em produção (mantidas da v1) — **nenhuma migração de schema** nesta fase. Colunas relevantes:
  - `categories(id uuid, name text, parent_id uuid null, monthly_target numeric null, counts bool, type text in income|expense|investment)`
  - `transactions(id uuid, external_id text null unique, occurred_on date, description text, amount numeric, kind expense|income, source bank|manual, category_id uuid null, status pending_review|confirmed, review_code text null)`
  - `category_rules(id uuid, pattern text, category_id uuid, updated_at)`
  - `financial_commitments(id uuid, description text, amount numeric null, day_of_month int, active bool)`
- Estado do sync bancário vive em `app_state` (chave `finance_last_imported`), NÃO em tabela própria (a `bank_sync_state` da v1 foi dropada na 0000).

---

### Task 1: Libs puras portadas da v1 (datas, moeda, código de revisão, intervalo de sync, árvore de categorias)

**Files:**
- Create: `apps/server/src/lib/dates.ts`
- Create: `apps/server/src/lib/dates.test.ts`
- Create: `apps/server/src/lib/format.ts`
- Create: `apps/server/src/lib/format.test.ts`
- Create: `apps/server/src/lib/review-code.ts`
- Create: `apps/server/src/lib/review-code.test.ts`
- Create: `apps/server/src/lib/sync-range.ts`
- Create: `apps/server/src/lib/sync-range.test.ts`
- Create: `apps/server/src/lib/category-tree.ts`
- Create: `apps/server/src/lib/category-tree.test.ts`

**Interfaces:**
- Consumes: nada (funções puras, sem I/O).
- Produces (usadas pelas tasks 3–8):
  - `todayInTz(tz: string, now?: Date): string` (YYYY-MM-DD), `addDays(isoDate: string, days: number): string`
  - `formatBrl(v: number): string`
  - `nextReviewCode(current: string | null): string`
  - `computeSyncRange(lastImported: string | null, yesterday: string, maxLookbackDays?: number): { from: string; to: string }`
  - `CategoryNode`, `categoryPath(id, cats): string | null`, `rootCategoryOf(id, cats): CategoryNode | null`

- [ ] **Step 1: Escrever os testes (falhando)**

`apps/server/src/lib/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, todayInTz } from './dates.js';

describe('todayInTz', () => {
  it('retorna YYYY-MM-DD no fuso pedido', () => {
    // 2026-07-13T01:00Z ainda é 2026-07-12 em São Paulo (UTC-3)
    expect(todayInTz('America/Sao_Paulo', new Date('2026-07-13T01:00:00Z'))).toBe('2026-07-12');
    expect(todayInTz('America/Sao_Paulo', new Date('2026-07-13T12:00:00Z'))).toBe('2026-07-13');
  });
});

describe('addDays', () => {
  it('soma e subtrai dias atravessando mês', () => {
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-07-13', 0)).toBe('2026-07-13');
  });
});
```

`apps/server/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBrl } from './format.js';

describe('formatBrl', () => {
  it('formata com vírgula decimal e 2 casas', () => {
    expect(formatBrl(24.9)).toBe('R$ 24,90');
    expect(formatBrl(1000)).toBe('R$ 1000,00');
  });
});
```

`apps/server/src/lib/review-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextReviewCode } from './review-code.js';

describe('nextReviewCode', () => {
  it('começa em A001 sem código anterior ou com código inválido', () => {
    expect(nextReviewCode(null)).toBe('A001');
    expect(nextReviewCode('xyz')).toBe('A001');
  });
  it('incrementa dentro da letra e troca de letra em 999', () => {
    expect(nextReviewCode('A001')).toBe('A002');
    expect(nextReviewCode('A999')).toBe('B001');
    expect(nextReviewCode('Z999')).toBe('A001');
  });
});
```

`apps/server/src/lib/sync-range.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeSyncRange } from './sync-range.js';

describe('computeSyncRange', () => {
  it('sem estado importa só ontem', () => {
    expect(computeSyncRange(null, '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-07-12' });
  });
  it('dia seguinte ao último importado até ontem (recupera gaps)', () => {
    expect(computeSyncRange('2026-07-08', '2026-07-12')).toEqual({ from: '2026-07-09', to: '2026-07-12' });
  });
  it('respeita o teto de lookback', () => {
    expect(computeSyncRange('2026-01-01', '2026-07-12', 30)).toEqual({ from: '2026-06-12', to: '2026-07-12' });
  });
  it('último importado hoje/futuro não gera from > to', () => {
    expect(computeSyncRange('2026-07-12', '2026-07-12')).toEqual({ from: '2026-07-12', to: '2026-07-12' });
  });
});
```

`apps/server/src/lib/category-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { categoryPath, rootCategoryOf, type CategoryNode } from './category-tree.js';

const cats: CategoryNode[] = [
  { id: 'r1', name: 'Casa', parent_id: null, monthly_target: 2000, counts: true, type: 'expense' },
  { id: 's1', name: 'Energia', parent_id: 'r1', monthly_target: null, counts: true, type: 'expense' },
  { id: 'r2', name: 'Investimentos', parent_id: null, monthly_target: null, counts: true, type: 'investment' },
];

describe('categoryPath', () => {
  it('subcategoria vira "Pai > Filho"; raiz é só o nome; id desconhecido é null', () => {
    expect(categoryPath('s1', cats)).toBe('Casa > Energia');
    expect(categoryPath('r1', cats)).toBe('Casa');
    expect(categoryPath('zz', cats)).toBeNull();
  });
});

describe('rootCategoryOf', () => {
  it('sobe até a raiz', () => {
    expect(rootCategoryOf('s1', cats)?.id).toBe('r1');
    expect(rootCategoryOf('r2', cats)?.id).toBe('r2');
    expect(rootCategoryOf('zz', cats)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run (na raiz do repo): `npx vitest run apps/server/src/lib/dates.test.ts apps/server/src/lib/format.test.ts apps/server/src/lib/review-code.test.ts apps/server/src/lib/sync-range.test.ts apps/server/src/lib/category-tree.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`apps/server/src/lib/dates.ts`:

```ts
export function todayInTz(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

`apps/server/src/lib/format.ts`:

```ts
export function formatBrl(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}
```

`apps/server/src/lib/review-code.ts`:

```ts
/** Próximo código curto de revisão: A001..A999, B001.., até Z999, depois recomeça. */
export function nextReviewCode(current: string | null): string {
  const m = current?.match(/^([A-Z])(\d{3})$/);
  if (!m) return 'A001';
  const letter = m[1];
  const num = Number(m[2]);
  if (num < 999) return `${letter}${String(num + 1).padStart(3, '0')}`;
  if (letter === 'Z') return 'A001';
  return `${String.fromCharCode(letter.charCodeAt(0) + 1)}001`;
}
```

`apps/server/src/lib/sync-range.ts`:

```ts
import { addDays } from './dates.js';

/** Intervalo de importação do banco a partir do último dia importado com sucesso.
 *  - sem estado: importa só ontem.
 *  - normal: importa só ontem.
 *  - após indisponibilidade: recupera do dia seguinte ao último até ontem.
 *  - teto de `maxLookbackDays` para não puxar um intervalo gigante. */
export function computeSyncRange(
  lastImported: string | null,
  yesterday: string,
  maxLookbackDays = 30,
): { from: string; to: string } {
  if (!lastImported) return { from: yesterday, to: yesterday };
  const floor = addDays(yesterday, -maxLookbackDays);
  let from = addDays(lastImported, 1);
  if (from < floor) from = floor;
  if (from > yesterday) from = yesterday;
  return { from, to: yesterday };
}
```

`apps/server/src/lib/category-tree.ts`:

```ts
export interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  monthly_target: number | null;
  counts: boolean;
  type: 'income' | 'expense' | 'investment';
}

/** "Casa > Energia" para subcategoria; só o nome para raiz; null se id desconhecido. */
export function categoryPath(id: string, cats: CategoryNode[]): string | null {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const cat = byId.get(id);
  if (!cat) return null;
  if (!cat.parent_id) return cat.name;
  const parent = byId.get(cat.parent_id);
  return parent ? `${parent.name} > ${cat.name}` : cat.name;
}

/** Categoria raiz de um id (ela mesma se já for raiz); null se desconhecido. */
export function rootCategoryOf(id: string, cats: CategoryNode[]): CategoryNode | null {
  const byId = new Map(cats.map((c) => [c.id, c]));
  let cat = byId.get(id) ?? null;
  let guard = 0;
  while (cat?.parent_id && guard++ < 10) {
    cat = byId.get(cat.parent_id) ?? cat;
    if (!cat.parent_id) break;
  }
  return cat;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: mesmo comando do Step 2. Expected: PASS (todos).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/lib
git commit -m "feat(f3): libs puras de finanças portadas da v1 (datas, moeda, review-code, sync-range, árvore de categorias)"
```

---

### Task 2: Cliente Banco MCP (mapeamento, saúde e transporte) + config

**Files:**
- Create: `apps/server/src/lib/banco-map.ts`
- Create: `apps/server/src/lib/banco-map.test.ts`
- Create: `apps/server/src/lib/banco-health.ts`
- Create: `apps/server/src/lib/banco-health.test.ts`
- Create: `apps/server/src/lib/banco-mcp.ts`
- Modify: `apps/server/src/lib/config.ts` (schema zod: adicionar `BANCO_MCP_TOKEN`)
- Modify: `docker-stack.yml` (adicionar a env var)
- Modify: `SETUP.md` (documentar a var)

**Interfaces:**
- Consumes: `getConfig()` de `../lib/config.js` (Task já existente).
- Produces:
  - `BankTransaction { id: string; date: string; description: string; amount: number; kind: 'expense' | 'income'; providerCategory: string | null }`
  - `mapProviderTx(tx: Record<string, unknown>, accountType: 'BANK' | 'CREDIT'): BankTransaction | null`
  - `isBankConfigured(): boolean`
  - `listBankTransactions(sinceDate: string, toDate?: string): Promise<BankTransaction[]>`
  - `checkBankHealth(): Promise<BankHealthSummary>`, `formatBankHealthAlert(summary): string`
  - Config: `BANCO_MCP_TOKEN: z.string().default('')`

- [ ] **Step 1: Testes das partes puras (falhando)**

`apps/server/src/lib/banco-map.test.ts`:

```ts
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
```

`apps/server/src/lib/banco-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBankHealthAlert, summarizeBankHealth } from './banco-health.js';

describe('summarizeBankHealth', () => {
  it('sem payloads → sem problemas', () => {
    expect(summarizeBankHealth(null, null)).toEqual({ problems: [], providerDegraded: false });
  });
  it('incidente do provedor atribuído ao banco conectado', () => {
    const s = summarizeBankHealth(
      { degraded: true, your_connected_banks: ['Itaú'], your_banks_affected: [{ name: 'Itaú Cartões - Conector Indisponível', impact: 'critical' }] },
      null,
    );
    expect(s.providerDegraded).toBe(true);
    expect(s.problems[0]).toMatchObject({ kind: 'provider_incident', bank: 'Itaú', severity: 'critical' });
  });
  it('conexão em LOGIN_ERROR vira problema; UPDATED/UPDATING não', () => {
    const s = summarizeBankHealth(null, {
      items: [
        { status: 'LOGIN_ERROR', executionStatus: '', connector: { name: 'Nubank' } },
        { status: 'UPDATED', executionStatus: 'SUCCESS', connector: { name: 'Itaú' } },
      ],
    });
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toMatchObject({ kind: 'connection_error', bank: 'Nubank', severity: 'LOGIN_ERROR' });
  });
});

describe('formatBankHealthAlert', () => {
  it('lista os problemas com prefixo do banco', () => {
    const text = formatBankHealthAlert({ problems: [{ kind: 'connection_error', bank: 'Nubank', detail: 'LOGIN_ERROR' }], providerDegraded: false });
    expect(text).toContain('Nubank: LOGIN_ERROR');
    expect(text).toContain('não é o seu sistema');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/lib/banco-map.test.ts apps/server/src/lib/banco-health.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar os três módulos + config**

`apps/server/src/lib/banco-map.ts` (porte fiel da v1, estilo v2):

```ts
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
```

`apps/server/src/lib/banco-health.ts` (porte fiel da v1, estilo v2 — mesmo conteúdo, com `;`):

```ts
/** Interpretação pura dos payloads de status do Banco MCP — sem I/O.
 *
 *  Dois sinais independentes indicam banco com problema:
 *   1. provider_status.your_banks_affected — incidente upstream no provedor/banco.
 *   2. item_status — conexão em LOGIN_ERROR / erro de execução que o usuário
 *      precisa reconectar.
 */

export interface BankHealthProblem {
  kind: 'provider_incident' | 'connection_error';
  bank: string | null;
  detail: string;
  severity?: string;
}

export interface BankHealthSummary {
  problems: BankHealthProblem[];
  providerDegraded: boolean;
}

const HEALTHY_ITEM_STATUSES = new Set(['UPDATED', 'UPDATING']);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function inferBank(incidentName: string, connectedBanks: string[]): string | null {
  const lower = incidentName.toLowerCase();
  return connectedBanks.find((b) => lower.includes(b.toLowerCase())) ?? null;
}

export function summarizeBankHealth(providerStatus: unknown, itemStatus: unknown): BankHealthSummary {
  const problems: BankHealthProblem[] = [];

  const provider = asRecord(providerStatus);
  const providerDegraded = provider?.degraded === true;
  const connectedBanks = asArray(provider?.your_connected_banks).map((b) => String(b));
  for (const raw of asArray(provider?.your_banks_affected)) {
    const inc = asRecord(raw);
    if (!inc) continue;
    const name = String(inc.name ?? '').trim();
    if (!name) continue;
    problems.push({
      kind: 'provider_incident',
      bank: inferBank(name, connectedBanks),
      detail: name,
      severity: inc.impact != null ? String(inc.impact) : undefined,
    });
  }

  const itemsRoot = asRecord(itemStatus);
  for (const raw of asArray(itemsRoot?.items)) {
    const it = asRecord(raw);
    if (!it) continue;
    const status = String(it.status ?? '');
    const execution = String(it.executionStatus ?? '');
    const ok = HEALTHY_ITEM_STATUSES.has(status) && (execution === '' || execution === 'SUCCESS');
    if (ok) continue;
    const connector = asRecord(it.connector);
    problems.push({
      kind: 'connection_error',
      bank: connector?.name != null ? String(connector.name) : null,
      detail: execution && execution !== 'SUCCESS' ? `${status} (${execution})` : status,
      severity: status,
    });
  }

  return { problems, providerDegraded };
}

/** Alerta enviado quando a revisão diária importou zero E há problema no banco. */
export function formatBankHealthAlert(summary: BankHealthSummary): string {
  const lines = [
    '⚠️ Não trouxe gastos de ontem para conferência — e detectei um problema nos bancos, então provavelmente é por isso (não é o seu sistema):',
    '',
  ];
  for (const p of summary.problems) {
    const prefix = p.bank ? `${p.bank}: ` : '';
    lines.push(`• ${prefix}${p.detail}`);
  }
  lines.push('');
  lines.push('Assim que o banco normalizar, os lançamentos entram no próximo update. 🔁');
  return lines.join('\n');
}
```

`apps/server/src/lib/banco-mcp.ts` (porte fiel da v1: transporte JSON-RPC streamable-HTTP com Bearer, sessão cacheada, retry em sessão expirada, erro de free tier legível):

```ts
import { getConfig } from './config.js';
import { mapProviderTx, type BankTransaction } from './banco-map.js';
import { summarizeBankHealth, type BankHealthSummary } from './banco-health.js';

export type { BankTransaction };

export function isBankConfigured(): boolean {
  return Boolean(getConfig().BANCO_MCP_TOKEN);
}

// ── Estado da sessão MCP (cache em módulo) ──────────────────────────────────
let sessionId: string | null = null;
let reqId = 1;

const BANCO_MCP_BASE_URL = 'https://api.mcp.ai';

/** Envia um request JSON-RPC ao endpoint Streamable-HTTP e parseia o corpo SSE. */
async function mcpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = reqId++;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  // Bearer em toda requisição: sessões recriadas já nascem autenticadas.
  const token = getConfig().BANCO_MCP_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(`${BANCO_MCP_BASE_URL}/banco`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 300));
    throw new Error(`Banco MCP HTTP ${res.status}: ${body}`);
  }

  const newSession = res.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;

  const text = await res.text();
  const dataLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`Banco MCP: no data line in response. Raw: ${text.slice(0, 300)}`);

  const parsed = JSON.parse(dataLine.slice('data: '.length)) as {
    id?: number;
    result?: unknown;
    error?: { message?: string };
  };

  if (parsed.error) {
    throw new Error(`Banco MCP JSON-RPC error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
  }
  return parsed.result;
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;
  await mcpRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'assistente-pessoal-v2', version: '1.0' },
  });
}

async function callToolRaw(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = (await mcpRequest('tools/call', { name, arguments: args })) as {
    content?: Array<{ type: string; text: string }>;
  } | null;

  const text = result?.content?.[0]?.text;
  if (text === undefined || text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Sessão expirada aparece como erro de "session", 404 ou 401. */
export function isStaleSessionError(message: string): boolean {
  return /session|404|401|authentication_required/i.test(message);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const attempt = async (): Promise<unknown> => {
    await ensureSession();
    const result = await callToolRaw(name, args);
    // O servidor responde 200 mesmo em erro de negócio, com { error, message } no payload.
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as { error?: string; message?: string };
      if (r.error) {
        if (r.error === 'free_tier_limit_reached') {
          throw new Error(
            'Limite do plano grátis do Banco MCP atingido. Assine um plano em https://app.mcp.ai para continuar importando transações.',
          );
        }
        throw new Error(`Banco MCP: ${r.message ?? r.error}`);
      }
    }
    return result;
  };
  try {
    return await attempt();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isStaleSessionError(msg)) {
      sessionId = null;
      try {
        return await attempt();
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (/401|authentication_required/i.test(retryMsg)) {
          throw new Error(
            'Banco MCP: token inválido ou expirado. Renove o BANCO_MCP_TOKEN em https://app.mcp.ai/agent-auth?toolkit=tk_pub_openfinance',
          );
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Saúde dos bancos: incidentes do provedor + status das conexões.
 *  Falha de rede degrada para "sem problemas detectados". */
export async function checkBankHealth(): Promise<BankHealthSummary> {
  const [provider, items] = await Promise.all([
    callTool('openfinance_provider_status', {}).catch(() => null),
    callTool('openfinance_get_item_status', {}).catch(() => null),
  ]);
  return summarizeBankHealth(provider, items);
}

export async function listBankTransactions(sinceDate: string, toDate?: string): Promise<BankTransaction[]> {
  const accountsResult = (await callTool('openfinance_list_accounts', {})) as {
    results?: Array<{ id: string; type: 'BANK' | 'CREDIT' }>;
  } | null;

  const accounts = accountsResult?.results ?? [];
  const all: BankTransaction[] = [];
  for (const account of accounts) {
    const txResult = (await callTool('openfinance_list_transactions', {
      account_id: account.id,
      from: sinceDate,
      to: toDate ?? sinceDate,
      page_size: 200,
    })) as { results?: Array<Record<string, unknown>> } | null;

    for (const tx of txResult?.results ?? []) {
      const mapped = mapProviderTx(tx, account.type);
      if (mapped) all.push(mapped);
    }
  }
  return all;
}
```

Em `apps/server/src/lib/config.ts`, dentro do `schema` zod, logo após `GOOGLE_REFRESH_TOKEN`:

```ts
  BANCO_MCP_TOKEN: z.string().default(''),
```

Em `docker-stack.yml`, na lista `environment`, logo após `GOOGLE_REFRESH_TOKEN`:

```yaml
      - BANCO_MCP_TOKEN=${BANCO_MCP_TOKEN:-}
```

Em `SETUP.md`, na seção de variáveis de ambiente, adicionar a linha:

```
BANCO_MCP_TOKEN=            # token do Banco MCP (app.mcp.ai/agent-auth?toolkit=tk_pub_openfinance); vazio desliga a importação bancária
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/lib/banco-map.test.ts apps/server/src/lib/banco-health.test.ts apps/server/src/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/lib docker-stack.yml SETUP.md
git commit -m "feat(f3): cliente Banco MCP (mapeamento, saúde, transporte) + BANCO_MCP_TOKEN"
```

---

### Task 3: Camada de dados financeira (`db/finance.ts`)

**Files:**
- Create: `apps/server/src/db/finance.ts`
- Create: `apps/server/src/db/finance.test.ts` (só o que é puro: `normalizePattern`)

**Interfaces:**
- Consumes: `supabase` de `./client.js`; `getState`/`setState` de `./state.js`; `nextReviewCode` de `../lib/review-code.js`.
- Produces (usadas pelas tasks 4, 5, 7 e 8):
  - `Category { id; name; parent_id; monthly_target; counts; type }` e `Transaction { id; occurred_on; description; amount; kind; source; category_id; status; review_code }`
  - `listCategories(): Promise<Category[]>`, `getCategoryByName(name): Promise<Category | null>`, `createCategory(name, parentName?): Promise<Category | { error: string }>`
  - `insertManualTransaction(opts): Promise<Transaction>`, `upsertBankTransactions(txs): Promise<Transaction[]>`
  - `setTransactionCategory(txId, categoryId): Promise<boolean>`, `suggestTransactionCategory(txId, categoryId): Promise<boolean>`, `confirmTransaction(txId): Promise<boolean>`
  - `listTransactionsBetween(fromDate, toDate): Promise<Array<Transaction & { category_name: string | null }>>`, `listPendingTransactions(): Promise<Transaction[]>`
  - `ensureReviewCode(txId): Promise<string | null>`, `getTransactionByReviewCode(code): Promise<Transaction | null>`, `getTransactionById(id): Promise<Transaction | null>`
  - `normalizePattern(desc): string`, `learnRule(description, categoryId): Promise<void>`, `applyRules(items): Promise<Map<string, string>>`
  - `Commitment { id; description; amount; day_of_month; active }`, `createCommitment(description, dayOfMonth, amount?)`, `listCommitments(onlyActive?)`, `deactivateCommitment(id)`
  - `getLastImportedDate(): Promise<string | null>`, `setLastImportedDate(date): Promise<void>`

- [ ] **Step 1: Teste do normalizePattern (falhando)**

`apps/server/src/db/finance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizePattern } from './finance.js';

describe('normalizePattern', () => {
  it('minúsculas, sem acentos, sem dígitos/pontuação, espaços colapsados', () => {
    expect(normalizePattern('UBER *TRIP 1234 SÃO PAULO')).toBe('uber trip sao paulo');
    expect(normalizePattern('PADARIA  DOCE-LAR 99')).toBe('padaria doce lar');
    expect(normalizePattern('123 456')).toBe('');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/db/finance.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/db/finance.ts` (porte da v1 com três mudanças: estilo v2 de erro `if (error) throw error`; estado do sync em `app_state`; `ensureReviewCode` busca só o maior código via `order+limit 1` em vez de trazer todos — evita o cap de 1000 linhas do PostgREST):

```ts
import { nextReviewCode } from '../lib/review-code.js';
import { supabase } from './client.js';
import { getState, setState } from './state.js';

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
  const { data, error } = await supabase.from('categories').select(CAT_COLS).ilike('name', name).maybeSingle();
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
  const { data, error } = await supabase.from('transactions').select(TX_COLS).ilike('review_code', code).maybeSingle();
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
 *  Se já existir regra para o mesmo pattern apontando para OUTRA categoria, a
 *  descrição é ambígua → remove a regra (futuras idênticas caem na IA/manual). */
export async function learnRule(description: string, categoryId: string): Promise<void> {
  const pattern = normalizePattern(description);
  if (!pattern) return;
  const { data: existing, error: selErr } = await supabase
    .from('category_rules')
    .select('id, category_id')
    .eq('pattern', pattern)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    if (existing.category_id === categoryId) {
      await supabase.from('category_rules').update({ updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('category_rules').delete().eq('id', existing.id);
    }
    return;
  }
  const { error } = await supabase
    .from('category_rules')
    .insert({ pattern, category_id: categoryId, updated_at: new Date().toISOString() });
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/db/finance.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/db
git commit -m "feat(f3): camada de dados financeira (transações, categorias, regras, compromissos, estado de sync)"
```

---

### Task 4: Categorização por IA + sync bancário (services) + purpose `categorize`

**Files:**
- Modify: `apps/server/src/agent/models.ts` (linha do `export type Purpose`)
- Modify: `apps/server/src/agent/models.test.ts` (1 teste novo)
- Create: `apps/server/src/services/categorize.ts`
- Create: `apps/server/src/services/categorize.test.ts`
- Create: `apps/server/src/services/bank-sync.ts`
- Create: `apps/server/src/services/bank-sync.test.ts`

**Interfaces:**
- Consumes: `generateAgentObject` de `../agent/models.js`; `applyRules`, `setTransactionCategory`, `upsertBankTransactions`, `type Category`, `type Transaction` de `../db/finance.js`; `categoryPath` de `../lib/category-tree.js`; `listBankTransactions` de `../lib/banco-mcp.js`.
- Produces:
  - `suggestCategoriesFor(txs: Array<{ id: string; description: string; amount: number }>, categories: Category[], deps?: CategorizeDeps): Promise<Map<string, Category>>`
  - `syncBankTransactions(fromDate: string, toDate: string, deps?: BankSyncDeps): Promise<{ imported: number; autoClassified: number }>`
  - Purpose `'categorize'` roteia para o modelo DEFAULT.

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/agent/models.test.ts`, adicionar dentro do `describe` de `pickModelId` (mantenha os existentes):

```ts
  it('categorize usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('categorize', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
```

(Se o teste existente referencia `cfg` com outro nome, siga o padrão do arquivo.)

`apps/server/src/services/categorize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Category } from '../db/finance.js';
import { suggestCategoriesFor, type CategorizeDeps } from './categorize.js';

const cats: Category[] = [
  { id: 'c1', name: 'Transporte', parent_id: null, monthly_target: null, counts: true, type: 'expense' },
  { id: 'c2', name: 'Casa', parent_id: null, monthly_target: 2000, counts: true, type: 'expense' },
  { id: 'c3', name: 'Energia', parent_id: 'c2', monthly_target: null, counts: true, type: 'expense' },
];

function deps(over: Partial<CategorizeDeps> = {}): CategorizeDeps {
  return {
    applyRules: async () => new Map(),
    generate: async () => ({ classifications: [] }) as never,
    ...over,
  };
}

describe('suggestCategoriesFor', () => {
  it('regra aprendida resolve sem chamar a IA', async () => {
    let aiCalled = false;
    const d = deps({
      applyRules: async () => new Map([['t1', 'c1']]),
      generate: async () => {
        aiCalled = true;
        return { classifications: [] } as never;
      },
    });
    const out = await suggestCategoriesFor([{ id: 't1', description: 'UBER', amount: 20 }], cats, d);
    expect(out.get('t1')?.id).toBe('c1');
    expect(aiCalled).toBe(false);
  });

  it('o que sobra vai para a IA; casa pelo ÚLTIMO segmento do caminho, case-insensitive', async () => {
    const d = deps({
      generate: async () =>
        ({ classifications: [{ id: 't2', category: 'casa > ENERGIA' }, { id: 't3', category: 'Inexistente' }] }) as never,
    });
    const out = await suggestCategoriesFor(
      [
        { id: 't2', description: 'CEMIG', amount: 150 },
        { id: 't3', description: 'XYZ', amount: 10 },
      ],
      cats,
      d,
    );
    expect(out.get('t2')?.id).toBe('c3');
    expect(out.has('t3')).toBe(false);
  });

  it('prompt oferece caminhos completos ("Casa > Energia")', async () => {
    let seenPrompt = '';
    const d = deps({
      generate: async (opts) => {
        seenPrompt = opts.prompt;
        return { classifications: [] } as never;
      },
    });
    await suggestCategoriesFor([{ id: 't1', description: 'CEMIG', amount: 150 }], cats, d);
    expect(seenPrompt).toContain('Casa > Energia');
  });
});
```

`apps/server/src/services/bank-sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/finance.js';
import { syncBankTransactions, type BankSyncDeps } from './bank-sync.js';

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
  it('importa, aplica regras nas novas e conta as auto-classificadas', async () => {
    const classified: string[] = [];
    const deps: BankSyncDeps = {
      listBankTransactions: async () => [
        { id: 'e1', date: '2026-07-12', description: 'UBER', amount: 10, kind: 'expense', providerCategory: null },
        { id: 'e2', date: '2026-07-12', description: 'XYZ', amount: 5, kind: 'expense', providerCategory: null },
      ],
      upsertBankTransactions: async (rows) => rows.map((r, i) => tx(`t${i + 1}`, r.description)),
      applyRules: async (items) => new Map(items.filter((i) => i.description === 'UBER').map((i) => [i.id, 'c1'])),
      setTransactionCategory: async (id, catId) => {
        classified.push(`${id}:${catId}`);
        return true;
      },
    };
    const r = await syncBankTransactions('2026-07-12', '2026-07-12', deps);
    expect(r).toEqual({ imported: 2, autoClassified: 1 });
    expect(classified).toEqual(['t1:c1']);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/services/categorize.test.ts apps/server/src/services/bank-sync.test.ts`
Expected: FAIL — `'categorize'` não é um Purpose válido; módulos de services não existem.

- [ ] **Step 3: Implementar**

Em `apps/server/src/agent/models.ts`, trocar a linha do Purpose:

```ts
export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize';
```

(`STRONG_PURPOSES` não muda — categorize fica no default.)

`apps/server/src/services/categorize.ts`:

```ts
import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import { applyRules, type Category } from '../db/finance.js';
import { categoryPath } from '../lib/category-tree.js';

const classificationSchema = z.object({
  classifications: z.array(z.object({ id: z.string(), category: z.string() })),
});
type Classification = z.infer<typeof classificationSchema>;

export type CategorizeDeps = {
  applyRules: typeof applyRules;
  generate: (opts: { purpose: 'categorize'; system: string; prompt: string; schema: z.Schema<Classification> }) => Promise<Classification>;
};

const defaultDeps: CategorizeDeps = {
  applyRules,
  generate: (opts) => generateAgentObject(opts),
};

/** Sugere uma categoria para cada transação. Primeiro aplica regras aprendidas
 *  (reclassificações anteriores); só o que sobrar vai para o modelo (default/barato).
 *  Casa a resposta da IA pelo ÚLTIMO segmento do caminho, case-insensitive. */
export async function suggestCategoriesFor(
  txs: Array<{ id: string; description: string; amount: number }>,
  categories: Category[],
  deps: CategorizeDeps = defaultDeps,
): Promise<Map<string, Category>> {
  const out = new Map<string, Category>();
  const byId = new Map(categories.map((c) => [c.id, c]));

  const ruleMatches = await deps.applyRules(txs.map((t) => ({ id: t.id, description: t.description })));
  for (const [txId, categoryId] of ruleMatches) {
    const cat = byId.get(categoryId);
    if (cat) out.set(txId, cat);
  }

  const remaining = txs.filter((t) => !out.has(t.id));
  if (remaining.length === 0) return out;

  const paths = categories.map((c) => categoryPath(c.id, categories) ?? c.name);
  const result = await deps.generate({
    purpose: 'categorize',
    system: 'Você classifica transações financeiras brasileiras em categorias de orçamento doméstico.',
    prompt: `Classifique cada transação numa das categorias: ${paths.join(', ')}.\nTransações:\n${remaining
      .map((t) => `${t.id}: ${t.description} (R$ ${t.amount})`)
      .join('\n')}\nResponda com a categoria mais provável para cada id (use exatamente os nomes dados, incluindo o caminho como "Casa > Energia" quando for subcategoria).`,
    schema: classificationSchema,
  });

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  for (const c of result.classifications) {
    const lastSegment = c.category.split('>').pop()?.trim().toLowerCase() ?? '';
    const cat = byName.get(lastSegment);
    if (cat) out.set(c.id, cat);
  }
  return out;
}
```

`apps/server/src/services/bank-sync.ts`:

```ts
import { applyRules, setTransactionCategory, upsertBankTransactions } from '../db/finance.js';
import { listBankTransactions } from '../lib/banco-mcp.js';

export type BankSyncDeps = {
  listBankTransactions: typeof listBankTransactions;
  upsertBankTransactions: typeof upsertBankTransactions;
  applyRules: typeof applyRules;
  setTransactionCategory: typeof setTransactionCategory;
};

const defaultDeps: BankSyncDeps = { listBankTransactions, upsertBankTransactions, applyRules, setTransactionCategory };

/** Importa transações do Banco MCP no intervalo e grava no Supabase (dedupe por external_id).
 *  Para as NOVAS, aplica regras aprendidas: as que casam já entram classificadas/confirmadas.
 *  Retorna quantas novas entraram e quantas foram auto-classificadas por regra. */
export async function syncBankTransactions(
  fromDate: string,
  toDate: string,
  deps: BankSyncDeps = defaultDeps,
): Promise<{ imported: number; autoClassified: number }> {
  const bankTxs = await deps.listBankTransactions(fromDate, toDate);
  const inserted = await deps.upsertBankTransactions(
    bankTxs
      .filter((t) => t.id)
      .map((t) => ({ externalId: t.id, occurredOn: t.date, description: t.description, amount: t.amount, kind: t.kind })),
  );
  const ruleMatches = await deps.applyRules(inserted.map((t) => ({ id: t.id, description: t.description })));
  let autoClassified = 0;
  for (const [txId, categoryId] of ruleMatches) {
    const ok = await deps.setTransactionCategory(txId, categoryId);
    if (ok) autoClassified++;
  }
  return { imported: inserted.length, autoClassified };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/services/categorize.test.ts apps/server/src/services/bank-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/agent/models.ts apps/server/src/agent/models.test.ts apps/server/src/services
git commit -m "feat(f3): categorização por IA (purpose categorize, modelo default) + sync bancário"
```

---

### Task 5: Tools de finanças (`tools/finance.ts`)

**Files:**
- Create: `apps/server/src/tools/finance.ts`
- Create: `apps/server/src/tools/finance.test.ts`

**Interfaces:**
- Consumes (tudo da Task 3 + Task 1): funções de `../db/finance.js`; `categoryPath`, `rootCategoryOf` de `../lib/category-tree.js`; `todayInTz` de `../lib/dates.js`; `getConfig` de `../lib/config.js`.
- Produces: `buildFinanceTools(deps?: FinanceToolDeps): ToolSet` com as tools `finance_add_transaction`, `finance_list_transactions`, `finance_month_summary`, `finance_list_categories`, `finance_create_category`, `finance_classify_transaction`, `finance_confirm_transaction`, `finance_add_commitment`, `finance_list_commitments`, `finance_remove_commitment`. Finanças são do casal — não há parâmetro `owner`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/tools/finance.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/tools/finance.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/tools/finance.ts`:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/tools/finance.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/tools
git commit -m "feat(f3): tools de finanças (transações, resumo do mês vs metas, categorias, compromissos)"
```

---

### Task 6: Prompt + registro das tools no agente

**Files:**
- Modify: `apps/server/src/agent/prompts.ts` (bloco `capabilities` e instruções)
- Modify: `apps/server/src/agent/prompts.test.ts` (2 testes novos)
- Modify: `apps/server/src/agent/agent.ts` (função `buildTools`)

**Interfaces:**
- Consumes: `buildFinanceTools()` da Task 5.
- Produces: agente com finanças em qualquer chat (finanças são do casal); prompt anuncia as tools e as regras de uso.

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/agent/prompts.test.ts`, adicionar ao `describe('buildSystemPrompt')`:

```ts
  it('menciona finanças e as tools de finanças', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('finance_month_summary');
    expect(p).toContain('finanças');
  });

  it('instrui sobre códigos de revisão e classificação', () => {
    const p = buildSystemPrompt(args).toLowerCase();
    expect(p).toContain('a001');
  });
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/agent/prompts.test.ts`
Expected: FAIL nos 2 testes novos.

- [ ] **Step 3: Implementar**

Em `apps/server/src/agent/prompts.ts`:

(a) No bloco `capabilities`, adicionar depois do bullet da lista de compras:

```
- Finanças (do casal): os gastos do banco entram sozinhos todo dia e passam por uma revisão diária no privado do Luis. Tools: finance_add_transaction (gasto/receita manual), finance_list_transactions, finance_month_summary (resumo do mês com gasto por categoria vs meta), finance_list_categories, finance_create_category, finance_classify_transaction, finance_confirm_transaction, finance_add_commitment, finance_list_commitments, finance_remove_commitment.
```

Ou seja, o template do `capabilities` fica:

```ts
  const capabilities = `

Capacidades:
- Tarefas: cada pessoa tem sua própria lista de tarefas (tools tasks_list, tasks_add, tasks_complete, tasks_update). ${ownerNote}${agendaBullet}
- Lista de compras: uma lista de compras única do casal (tools shopping_list, shopping_add, shopping_remove, shopping_clear) — mora no grupo, mas também está acessível nos chats privados.
- Finanças (do casal): os gastos do banco entram sozinhos todo dia e passam por uma revisão diária no privado do Luis. Tools: finance_add_transaction (gasto/receita manual), finance_list_transactions, finance_month_summary (resumo do mês com gasto por categoria vs meta), finance_list_categories, finance_create_category, finance_classify_transaction, finance_confirm_transaction, finance_add_commitment, finance_list_commitments, finance_remove_commitment.

Instruções para usar as tools:
- Para concluir ou remover ${hasCalendar ? 'uma tarefa, um evento ou um item' : 'uma tarefa ou um item'}, primeiro liste (${hasCalendar ? 'tasks_list/calendar_list_events/shopping_list' : 'tasks_list/shopping_list'}) para conseguir o id correto — nunca invente um id. Se precisar do id de algo mencionado antes, chame a tool de listagem de novo em silêncio.
- Antes de chamar ${hasCalendar ? 'shopping_clear ou calendar_delete_event' : 'shopping_clear'}, confirme com o usuário na conversa que é isso mesmo que ele quer, e só chame a tool depois da confirmação.
- Finanças: quando o usuário citar um código curto de revisão (ex.: "A001 é mercado"), use finance_classify_transaction com esse código; a categoria precisa existir — se tiver dúvida, chame finance_list_categories em silêncio antes. Códigos curtos como A001 PODEM aparecer nas respostas (são feitos para o usuário); valores sempre como "R$ 123,45".` ;
```

(b) O bloco "Estilo das respostas" não muda.

Em `apps/server/src/agent/agent.ts`:

```ts
import { buildFinanceTools } from '../tools/finance.js';
```

e em `buildTools`, adicionar a linha após `...buildShoppingTools(identity),`:

```ts
    ...buildFinanceTools(),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/agent/prompts.test.ts apps/server/src/agent/agent.test.ts`
Expected: PASS (incluindo os testes existentes do agente).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/agent
git commit -m "feat(f3): finanças no prompt e no registro de tools do agente"
```

---

### Task 7: Botão ✅ de confirmação (callback do Telegram)

**Files:**
- Create: `apps/server/src/bot/callback.ts`
- Create: `apps/server/src/bot/callback.test.ts`
- Modify: `apps/server/src/bot/bot.ts` (handler `callback_query:data`)

**Interfaces:**
- Consumes: `confirmTransaction`, `getTransactionById`, `learnRule` de `../db/finance.js`.
- Produces: `encodeFinAction('ok', txId): string` (usado pela Task 8 na revisão diária) e `decodeAction(data): FinAction | null`; clicar ✅ confirma a transação na categoria mostrada, edita a mensagem e aprende a regra.

- [ ] **Step 1: Testes do codec (falhando)**

`apps/server/src/bot/callback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAction, encodeFinAction } from './callback.js';

describe('callback codec', () => {
  it('roundtrip fin:ok', () => {
    const data = encodeFinAction('ok', 'abc-123');
    expect(decodeAction(data)).toEqual({ kind: 'fin', action: 'ok', txId: 'abc-123' });
  });
  it('rejeita payloads desconhecidos', () => {
    expect(decodeAction('task:done:1')).toBeNull();
    expect(decodeAction('fin:nope:1')).toBeNull();
    expect(decodeAction('fin:ok:')).toBeNull();
    expect(decodeAction('lixo')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/bot/callback.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/bot/callback.ts` (na v2 só existem ações de finanças):

```ts
export type FinCallbackAction = 'ok';

export interface FinAction {
  kind: 'fin';
  action: FinCallbackAction;
  txId: string;
}

export function encodeFinAction(action: FinCallbackAction, txId: string): string {
  return `fin:${action}:${txId}`;
}

export function decodeAction(data: string): FinAction | null {
  const [kind, action, txId] = data.split(':');
  if (kind !== 'fin' || action !== 'ok' || !txId) return null;
  return { kind: 'fin', action, txId };
}
```

Em `apps/server/src/bot/bot.ts`, adicionar os imports:

```ts
import { confirmTransaction, getTransactionById, learnRule } from '../db/finance.js';
import { decodeAction } from './callback.js';
```

e registrar o handler ANTES de `bot.on('message:text', ...)`:

```ts
  // Botão ✅ da revisão diária de gastos: confirma na categoria mostrada e aprende a regra.
  bot.on('callback_query:data', async (ctx) => {
    try {
      const action = decodeAction(ctx.callbackQuery.data);
      if (!action) return void (await ctx.answerCallbackQuery());
      const ok = await confirmTransaction(action.txId);
      await ctx.answerCallbackQuery({ text: ok ? 'Confirmado ✅' : 'Não encontrada' });
      if (!ok) return;
      await ctx.editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Gasto confirmado'}`);
      // confirmar = endossar a categoria mostrada → aprende a regra (nunca quebra o fluxo)
      try {
        const tx = await getTransactionById(action.txId);
        if (tx?.category_id) await learnRule(tx.description, tx.category_id);
      } catch (err) {
        console.error('[bot] fin confirm: learnRule falhou:', err);
      }
    } catch (err) {
      console.error('[bot:callback]', err);
      await ctx.answerCallbackQuery({ text: '❌ Erro, tenta de novo.' }).catch(() => {});
    }
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/bot/callback.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/bot
git commit -m "feat(f3): botão de confirmação de gasto (callback fin:ok + aprendizado de regra)"
```

---

### Task 8: Revisão diária de gastos (job) + agendamento

**Files:**
- Create: `apps/server/src/jobs/finance-review.ts`
- Create: `apps/server/src/jobs/finance-review.test.ts`
- Modify: `apps/server/src/db/chats.ts` (adicionar `getSubjectChatId`)
- Modify: `apps/server/src/jobs/scheduler.ts` (agendar 08:00 + assinatura `startScheduler(bot)`)
- Modify: `apps/server/src/index.ts` (passar o bot ao scheduler)
- Create: `apps/server/src/scripts/run-finance-review.ts` (execução manual)
- Modify: `apps/server/package.json` (script `job:finance`)

**Interfaces:**
- Consumes: Tasks 1–5 e 7 (`computeSyncRange`, `syncBankTransactions`, `suggestCategoriesFor`, `checkBankHealth`/`isBankConfigured`/`formatBankHealthAlert`, db/finance, `encodeFinAction`, `formatBrl`, `addDays`/`todayInTz`, `categoryPath`).
- Produces: `runFinanceReview(bot: Bot): Promise<void>`; `formatReviewLine(tx, code, catName): string` (pura, exportada para teste); `getSubjectChatId(subject): Promise<number | null>`; cron diário `0 8 * * *` no fuso configurado.

- [ ] **Step 1: Teste da formatação (falhando)**

`apps/server/src/jobs/finance-review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatReviewLine } from './finance-review.js';

describe('formatReviewLine', () => {
  it('mostra código, data curta BR, valor em R$ e categoria', () => {
    const line = formatReviewLine(
      { occurred_on: '2026-07-12', description: 'UBER TRIP', amount: 24.9 },
      'A001',
      'Transporte > App',
    );
    expect(line).toContain('[A001]');
    expect(line).toContain('12/07');
    expect(line).toContain('R$ 24,90');
    expect(line).toContain('Transporte > App');
    expect(line).not.toContain('2026-07-12');
  });
  it('sem código ainda funciona', () => {
    const line = formatReviewLine({ occurred_on: '2026-07-12', description: 'X', amount: 1 }, null, 'Sem categoria');
    expect(line).not.toContain('[');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/jobs/finance-review.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Em `apps/server/src/db/chats.ts`, adicionar ao final:

```ts
/** chat_id do Telegram do privado de um usuário (para jobs que enviam mensagem direta). */
export async function getSubjectChatId(subject: 'luis' | 'esposa'): Promise<number | null> {
  const { data, error } = await supabase
    .from('users')
    .select('telegram_chat_id')
    .eq('subject', subject)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.telegram_chat_id) : null;
}
```

`apps/server/src/jobs/finance-review.ts` (porte da v1 adaptado: destino = privado do Luis via `getSubjectChatId`; datas/estado v2):

```ts
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { encodeFinAction } from '../bot/callback.js';
import { getSubjectChatId } from '../db/chats.js';
import {
  ensureReviewCode,
  getLastImportedDate,
  listCategories,
  listTransactionsBetween,
  setLastImportedDate,
  suggestTransactionCategory,
  type Category,
} from '../db/finance.js';
import { checkBankHealth, isBankConfigured } from '../lib/banco-mcp.js';
import { formatBankHealthAlert } from '../lib/banco-health.js';
import { categoryPath } from '../lib/category-tree.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';
import { computeSyncRange } from '../lib/sync-range.js';
import { syncBankTransactions } from '../services/bank-sync.js';
import { suggestCategoriesFor } from '../services/categorize.js';

const MAX_REVIEW = 15;

/** Linha da mensagem de revisão de UMA transação (pura, para teste). */
export function formatReviewLine(
  tx: { occurred_on: string; description: string; amount: number },
  code: string | null,
  catName: string,
): string {
  const [, m, d] = tx.occurred_on.split('-');
  return `${code ? `[${code}] ` : ''}${d}/${m}: ${tx.description} — ${formatBrl(Number(tx.amount))}\n🏷 ${catName}\n(✅ confirma; para trocar, responda: "${code ?? 'A001'} é <categoria>")`;
}

/** Revisão diária: importa do banco, sugere categorias e envia os pendentes
 *  ao privado do Luis, um por mensagem, com botão ✅. */
export async function runFinanceReview(bot: Bot): Promise<void> {
  const config = getConfig();
  const chatId = await getSubjectChatId('luis');
  if (chatId === null) return;

  const yesterday = addDays(todayInTz(config.TIMEZONE), -1);

  // 1) importa do banco (se configurado)
  let importedCount = 0; // total do intervalo (após um gap, cobre vários dias)
  let syncOk = false;
  if (isBankConfigured()) {
    try {
      const { from, to } = computeSyncRange(await getLastImportedDate(), yesterday);
      const synced = await syncBankTransactions(from, to);
      importedCount = synced.imported;
      await setLastImportedDate(yesterday);
      syncOk = true;
    } catch (err) {
      console.error('[job:finance-review] importação do Banco MCP falhou:', err);
      const reason = err instanceof Error ? err.message : '';
      await bot.api.sendMessage(
        chatId,
        `⚠️ Não consegui importar os gastos do banco${reason ? `:\n${reason}` : '.'}\nVou revisar só o que está pendente.`,
      );
    }
  }

  // 1b) Importou OK mas veio zero: pode ser dia sem gasto OU banco com problema.
  // Checa a saúde e avisa só se houver incidente — o silêncio nunca fica ambíguo.
  if (syncOk && importedCount === 0) {
    try {
      const health = await checkBankHealth();
      if (health.problems.length > 0) {
        await bot.api.sendMessage(chatId, formatBankHealthAlert(health));
      }
    } catch (err) {
      console.error('[job:finance-review] checagem de saúde do banco falhou:', err);
    }
  }

  // 2) pendentes de revisão (últimos 30 dias até hoje)
  const pending = (await listTransactionsBetween(addDays(yesterday, -30), todayInTz(config.TIMEZONE))).filter(
    (t) => t.status === 'pending_review',
  );
  if (pending.length === 0) return; // nada a revisar; silêncio

  const toReview = pending.slice(0, MAX_REVIEW);
  const extra = pending.length - toReview.length;

  // 3) sugere categorias com o modelo — falha aqui não pode matar a revisão
  const categories = await listCategories();
  let suggestions = new Map<string, Category>();
  try {
    suggestions = await suggestCategoriesFor(
      toReview.map((t) => ({ id: t.id, description: t.description, amount: Number(t.amount) })),
      categories,
    );
  } catch (err) {
    console.error('[job:finance-review] sugestão de categorias falhou:', err);
  }

  // 4) uma mensagem por transação, com botão ✅
  await bot.api.sendMessage(
    chatId,
    `💸 Gastos para revisar (${pending.length})${extra > 0 ? `, mostrando os ${toReview.length} mais recentes:` : ':'}`,
  );
  for (const t of toReview) {
    const suggested = suggestions.get(t.id);
    // só exibe a sugestão se ela foi gravada (senão o ✅ confirmaria algo diferente do mostrado)
    let applied = false;
    if (suggested) applied = await suggestTransactionCategory(t.id, suggested.id).catch(() => false);
    const catName =
      applied && suggested
        ? (categoryPath(suggested.id, categories) ?? suggested.name)
        : t.category_id
          ? (categoryPath(t.category_id, categories) ?? t.category_name ?? 'Sem categoria')
          : 'Sem categoria';
    const code = await ensureReviewCode(t.id).catch(() => null);
    const kb = new InlineKeyboard().text('✅ Confirmar', encodeFinAction('ok', t.id));
    await bot.api.sendMessage(chatId, formatReviewLine(t, code, catName), { reply_markup: kb });
  }

  if (extra > 0) {
    await bot.api.sendMessage(chatId, `+${extra} gastos pendentes. Veja todos na página Transações do site.`);
  }
}
```

`apps/server/src/jobs/scheduler.ts` (nova assinatura — recebe o bot):

```ts
import cron from 'node-cron';
import type { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runReflection } from '../memory/reflection.js';
import { runFinanceReview } from './finance-review.js';

export function startScheduler(bot: Bot): void {
  const cfg = getConfig();
  cron.schedule(
    '0 3 * * *',
    () => {
      runReflection().catch((err) => console.error('[job:reflection]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  cron.schedule(
    '0 8 * * *',
    () => {
      runFinanceReview(bot).catch((err) => console.error('[job:finance-review]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  console.log(`[scheduler] reflexão 03:00 e revisão financeira 08:00 ${cfg.TIMEZONE}`);
}
```

Em `apps/server/src/index.ts`, trocar `startScheduler();` por `startScheduler(bot);`.

`apps/server/src/scripts/run-finance-review.ts`:

```ts
// Roda a revisão financeira manualmente (uso: npm run job:finance -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runFinanceReview } from '../jobs/finance-review.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
await runFinanceReview(bot);
console.log('revisão financeira executada');
```

Em `apps/server/package.json`, adicionar em `scripts`:

```json
    "job:finance": "tsx src/scripts/run-finance-review.ts",
```

- [ ] **Step 4: Rodar TODOS os testes e typecheck**

Run: `npx vitest run` (raiz do repo)
Expected: PASS em toda a suíte (nenhuma regressão).

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/jobs apps/server/src/db/chats.ts apps/server/src/index.ts apps/server/src/scripts/run-finance-review.ts apps/server/package.json
git commit -m "feat(f3): revisão diária de gastos às 08:00 (import + sugestão + botões) no privado do Luis"
```

---

## Pós-merge (operacional — controlador + Luis, fora dos subagentes)

1. **Merge** na master local (finishing-a-development-branch, opção 1).
2. **Seed do backfill de julho** (eu, via Management API do Supabase): as transações de 01–12/07 foram apagadas pela 0000; com o seed abaixo, a primeira revisão importa o mês inteiro até ontem (lookback de 30 dias cobre):
   ```sql
   insert into app_state (key, value) values ('finance_last_imported', '"2026-06-30"')
   on conflict (key) do update set value = excluded.value;
   ```
3. **Luis:** `git push`.
4. **Luis (VPS, terminal da Hostinger):** adicionar ao `.env` do projeto a linha `BANCO_MCP_TOKEN=<token da v1>` (mesmo token que a v1 usava) e forçar o deploy (`FORCE=1 bash scripts/deploy-pull.sh` ou aguardar o cron de 30min).
5. **UAT:**
   - `npm run job:finance -w apps/server` no VPS (ou aguardar 08:00) → chegam as mensagens de revisão com botões no privado do Luis, com o backlog de julho.
   - Clicar ✅ numa transação → mensagem vira `✅ ...` e a transação aparece confirmada no site.
   - "A00X é mercado" no chat → reclassifica e aprende.
   - "quanto gastamos esse mês?" → resumo com categorias vs metas.
   - "gastei 50 reais na feira hoje" → transação manual.
   - Dashboard (site) mostra as transações de julho importadas.
