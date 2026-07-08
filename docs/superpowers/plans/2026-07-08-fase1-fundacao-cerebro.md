# Fase 1 — Fundação + Cérebro: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot Telegram conversacional com memória de longo prazo (3 camadas), roteador de modelos com guarda de custo (R$ 50/mês) e reflexão noturna — critério de aceite: conversar hoje e ele lembrar amanhã.

**Architecture:** Um serviço Node/TS ESM único (bot grammY + agente Vercel AI SDK + jobs node-cron), Supabase novo com pgvector para memórias e histórico. Toda chamada de LLM passa por um wrapper que registra tokens/custo em `llm_usage` e degrada o modelo quando o orçamento estoura. Job noturno destila as conversas do dia em fatos duráveis.

**Tech Stack:** Node 22, TypeScript 5 (ESM, NodeNext), grammY ^1, `ai` ^5 + `@ai-sdk/openai` ^2, zod ^3.25, @supabase/supabase-js ^2, node-cron ^3, vitest ^3, tsx (dev), Docker.

## Global Constraints

- Copy voltada ao usuário sempre em **PT-BR**; código/identificadores em inglês.
- ESM com `moduleResolution: NodeNext` → **todo import relativo termina em `.js`**.
- IDs de modelo **somente via env** (`MODEL_DEFAULT_ID=gpt-5-mini`, `MODEL_STRONG_ID=gpt-5.5`, `EMBEDDING_MODEL_ID=text-embedding-3-small`); nenhum id hardcoded fora de `lib/pricing.ts`.
- Orçamento: `LLM_BUDGET_BRL=50`; aviso em ≥80%, degradação para modelo default em ≥100% — **nunca** parar de responder.
- Timezone de jobs: `America/Sao_Paulo` (env `TIMEZONE`).
- Testes **nunca** chamam LLM ou Supabase reais — dependências injetadas.
- Secrets só em `.env` (gitignored); `.env.example` sempre atualizado.
- Embeddings: 1536 dimensões (text-embedding-3-small).

## Estrutura de arquivos (visão geral)

```
apps/server/src/
├── index.ts                 # bootstrap: config → bot → scheduler
├── lib/config.ts            # loadConfig (zod) + getConfig singleton
├── lib/pricing.ts           # tabela de preços + estimateCostBrl
├── lib/budget.ts            # budgetStatus (ok|warn|exceeded)
├── lib/alerts.ts            # createBudgetAlert (dedup mensal + envia Telegram)
├── db/client.ts             # supabase client (service role)
├── db/usage.ts              # recordUsage, getMonthCostBrl
├── db/chats.ts              # getChatIdentity
├── db/messages.ts           # saveMessage, getRecentMessages
├── db/memories.ts           # insertMemory, searchMemories, updateMemoryContent, expireMemory, listActiveMemories
├── db/state.ts              # getState, setState (app_state kv)
├── agent/models.ts          # Purpose, pickModelId, generateAgentText, generateAgentObject
├── agent/prompts.ts         # subjectsForChat, buildSystemPrompt
├── agent/agent.ts           # handleMessage (loop do agente) + buildTools (save_memory)
├── memory/embeddings.ts     # embedText
├── memory/recall.ts         # recallMemories
├── memory/reflection.ts     # reflectionOutputSchema, applyOps, runReflection
├── bot/bot.ts               # createBot: /id, whitelist, handler → agente
├── jobs/scheduler.ts        # cron 03:00 → runReflection
└── scripts/run-reflection.ts# npm run job:reflect (forçar reflexão p/ teste)
supabase/migrations/0001_init.sql
```

---

### Task 1: Scaffold do monorepo + config loader

**Files:**
- Create: `package.json`, `apps/server/package.json`, `tsconfig.base.json`, `apps/server/tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `apps/server/src/lib/config.ts`
- Test: `apps/server/src/lib/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`, `getConfig(): Config` — `Config` tem `TELEGRAM_TOKEN, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MODEL_DEFAULT_ID, MODEL_STRONG_ID, EMBEDDING_MODEL_ID, LLM_BUDGET_BRL: number, USD_BRL_RATE: number, TIMEZONE`.

- [ ] **Step 1: Criar arquivos de scaffold**

`package.json` (raiz):
```json
{
  "name": "assistente-pessoal-v2",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "npm run dev -w apps/server",
    "build": "npm run build -w apps/server",
    "typecheck": "npm run typecheck -w apps/server",
    "test": "vitest run",
    "job:reflect": "npm run job:reflect -w apps/server"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/server/package.json`:
```json
{
  "name": "@assistente/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "job:reflect": "tsx src/scripts/run-reflection.ts"
  },
  "dependencies": {
    "@ai-sdk/openai": "^2.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "ai": "^5.0.0",
    "grammy": "^1.30.0",
    "node-cron": "^3.0.3",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['apps/server/src/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
dist/
.env
```

`.env.example`:
```
TELEGRAM_TOKEN=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
MODEL_DEFAULT_ID=gpt-5-mini
MODEL_STRONG_ID=gpt-5.5
EMBEDDING_MODEL_ID=text-embedding-3-small
LLM_BUDGET_BRL=50
USD_BRL_RATE=5.5
TIMEZONE=America/Sao_Paulo
```

- [ ] **Step 2: Instalar dependências**

Run: `npm install`
Expected: sem erros; `node_modules/` criado.

- [ ] **Step 3: Escrever o teste do config (falhando)**

`apps/server/src/lib/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const minimal = {
  TELEGRAM_TOKEN: 't',
  OPENAI_API_KEY: 'k',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
};

describe('loadConfig', () => {
  it('aplica defaults quando opcionais faltam', () => {
    const cfg = loadConfig(minimal as NodeJS.ProcessEnv);
    expect(cfg.MODEL_DEFAULT_ID).toBe('gpt-5-mini');
    expect(cfg.MODEL_STRONG_ID).toBe('gpt-5.5');
    expect(cfg.EMBEDDING_MODEL_ID).toBe('text-embedding-3-small');
    expect(cfg.LLM_BUDGET_BRL).toBe(50);
    expect(cfg.USD_BRL_RATE).toBe(5.5);
    expect(cfg.TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('converte números vindos de string', () => {
    const cfg = loadConfig({ ...minimal, LLM_BUDGET_BRL: '80' } as NodeJS.ProcessEnv);
    expect(cfg.LLM_BUDGET_BRL).toBe(80);
  });

  it('falha sem TELEGRAM_TOKEN', () => {
    const { TELEGRAM_TOKEN: _omit, ...rest } = minimal;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow();
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 5: Implementar `config.ts`**

`apps/server/src/lib/config.ts`:
```ts
import { z } from 'zod';

const schema = z.object({
  TELEGRAM_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MODEL_DEFAULT_ID: z.string().default('gpt-5-mini'),
  MODEL_STRONG_ID: z.string().default('gpt-5.5'),
  EMBEDDING_MODEL_ID: z.string().default('text-embedding-3-small'),
  LLM_BUDGET_BRL: z.coerce.number().positive().default(50),
  USD_BRL_RATE: z.coerce.number().positive().default(5.5),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return schema.parse(env);
}

let cached: Config | undefined;
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
```

- [ ] **Step 6: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: 3 testes PASS; typecheck limpo.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold do monorepo v2 + config loader"
```

---

### Task 2: Migração inicial do Supabase + SETUP.md + cliente

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `SETUP.md`, `apps/server/src/db/client.ts`

**Interfaces:**
- Produces: `supabase` (client singleton); tabelas `users(id, name, subject, telegram_chat_id)`, `chats(id, kind, user_id)`, `messages`, `memories(embedding vector(1536))`, `llm_usage`, `app_state`; função SQL `match_memories(query_embedding, subjects text[], match_count)`.

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0001_init.sql`:
```sql
create extension if not exists vector;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text unique not null check (subject in ('luis','esposa')),
  telegram_chat_id bigint unique not null
);

create table chats (
  id bigint primary key,
  kind text not null check (kind in ('private','group')),
  user_id uuid references users(id)
);

create table messages (
  id bigserial primary key,
  chat_id bigint not null references chats(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index messages_chat_created_idx on messages (chat_id, created_at desc);

create table memories (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (subject in ('luis','esposa','casal')),
  type text not null check (type in ('preference','habit','fact','decision','person')),
  content text not null,
  embedding vector(1536) not null,
  source text not null default 'conversation',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index memories_embedding_idx on memories using hnsw (embedding vector_cosine_ops);

create table llm_usage (
  id bigserial primary key,
  model text not null,
  purpose text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_brl numeric(10,4) not null,
  created_at timestamptz not null default now()
);
create index llm_usage_created_idx on llm_usage (created_at);

create table app_state (
  key text primary key,
  value jsonb not null
);

create or replace function match_memories(
  query_embedding vector(1536),
  subjects text[],
  match_count int default 6
) returns table (id uuid, subject text, type text, content text, similarity float)
language sql stable as $$
  select m.id, m.subject, m.type, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.active
    and m.subject = any(subjects)
    and (m.expires_at is null or m.expires_at > now())
  order by m.embedding <=> query_embedding
  limit match_count;
$$;
```

- [ ] **Step 2: Escrever `SETUP.md`**

```markdown
# Setup v2 (fazer uma vez)

## 1. Bot do Telegram (novo, separado da v1)
1. @BotFather → `/newbot` → nome/username novos → token em `TELEGRAM_TOKEN`.
2. `/setprivacy` → bot → **Disable** (para ler o grupo).

## 2. OpenAI
API key em `OPENAI_API_KEY` (platform.openai.com).

## 3. Supabase (projeto novo, separado da v1)
1. supabase.com → New project.
2. SQL Editor → rodar `supabase/migrations/0001_init.sql`.
3. Settings → API: `Project URL` → `SUPABASE_URL`; `service_role` → `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Chat ids
1. Copie `.env.example` → `.env`, preencha tokens.
2. `npm run dev`; envie `/id` no privado (cada um) e no grupo novo (vocês dois + bot).

## 5. Cadastrar usuários e chats (SQL Editor)
​```sql
insert into users (name, subject, telegram_chat_id) values
  ('Luis', 'luis', SEU_CHAT_ID),
  ('Esposa', 'esposa', CHAT_ID_DELA);

insert into chats (id, kind, user_id) values
  (SEU_CHAT_ID, 'private', (select id from users where subject = 'luis')),
  (CHAT_ID_DELA, 'private', (select id from users where subject = 'esposa')),
  (CHAT_ID_DO_GRUPO, 'group', null);
​```
```

- [ ] **Step 3: Implementar `db/client.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../lib/config.js';

const cfg = getConfig();

export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: limpo. (Sem teste unitário: arquivo é só IO/config; validação real acontece no smoke E2E da Task 12.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: migração inicial do Supabase (pgvector) + SETUP + cliente"
```

---

### Task 3: Preços e orçamento (funções puras)

**Files:**
- Create: `apps/server/src/lib/pricing.ts`, `apps/server/src/lib/budget.ts`
- Test: `apps/server/src/lib/pricing.test.ts`, `apps/server/src/lib/budget.test.ts`

**Interfaces:**
- Produces: `estimateCostBrl(modelId: string, inputTokens: number, outputTokens: number, usdBrlRate: number): number`; `type BudgetStatus = 'ok' | 'warn' | 'exceeded'`; `budgetStatus(monthCostBrl: number, budgetBrl: number): BudgetStatus`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/lib/pricing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { estimateCostBrl } from './pricing.js';

describe('estimateCostBrl', () => {
  it('calcula custo do gpt-5-mini em BRL', () => {
    // 1M in ($0.25) + 1M out ($2.00) = $2.25 * 5.5 = R$ 12,375
    expect(estimateCostBrl('gpt-5-mini', 1_000_000, 1_000_000, 5.5)).toBeCloseTo(12.375);
  });

  it('embedding tem custo só de input', () => {
    expect(estimateCostBrl('text-embedding-3-small', 1_000_000, 0, 5.0)).toBeCloseTo(0.1);
  });

  it('modelo desconhecido usa preço conservador (não zero)', () => {
    expect(estimateCostBrl('modelo-novo', 1_000_000, 0, 5.0)).toBeGreaterThan(0);
  });
});
```

`apps/server/src/lib/budget.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { budgetStatus } from './budget.js';

describe('budgetStatus', () => {
  it('ok abaixo de 80%', () => expect(budgetStatus(39.9, 50)).toBe('ok'));
  it('warn em 80%', () => expect(budgetStatus(40, 50)).toBe('warn'));
  it('exceeded em 100%', () => expect(budgetStatus(50, 50)).toBe('exceeded'));
  it('exceeded acima do teto', () => expect(budgetStatus(70, 50)).toBe('exceeded'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`apps/server/src/lib/pricing.ts`:
```ts
const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5.5': { input: 1.25, output: 10.0 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

// Modelo fora da tabela: assume preço alto para o orçamento errar para o lado seguro.
const FALLBACK = { input: 5.0, output: 25.0 };

export function estimateCostBrl(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  usdBrlRate: number,
): number {
  const p = PRICES_USD_PER_MTOK[modelId] ?? FALLBACK;
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return usd * usdBrlRate;
}
```

`apps/server/src/lib/budget.ts`:
```ts
export type BudgetStatus = 'ok' | 'warn' | 'exceeded';

export function budgetStatus(monthCostBrl: number, budgetBrl: number): BudgetStatus {
  if (monthCostBrl >= budgetBrl) return 'exceeded';
  if (monthCostBrl >= budgetBrl * 0.8) return 'warn';
  return 'ok';
}
```

- [ ] **Step 4: Rodar testes**

Run: `npm test`
Expected: PASS (7 testes no total até aqui).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cálculo de custo por modelo e status de orçamento"
```

---

### Task 4: Repositórios de dados (usage, chats, messages, memories, state)

**Files:**
- Create: `apps/server/src/db/usage.ts`, `apps/server/src/db/chats.ts`, `apps/server/src/db/messages.ts`, `apps/server/src/db/memories.ts`, `apps/server/src/db/state.ts`

**Interfaces:**
- Produces:
  - `type UsageRow = { model: string; purpose: string; inputTokens: number; outputTokens: number; costBrl: number }`; `recordUsage(u: UsageRow): Promise<void>`; `getMonthCostBrl(): Promise<number>`
  - `type ChatIdentity = { chatId: number; kind: 'private' | 'group'; userName: string | null; subject: 'luis' | 'esposa' | null }`; `getChatIdentity(chatId: number): Promise<ChatIdentity | null>`
  - `type ChatRole = 'user' | 'assistant'`; `saveMessage(m: { chatId: number; role: ChatRole; content: string }): Promise<void>`; `getRecentMessages(chatId: number, limit?: number): Promise<{ role: ChatRole; content: string }[]>` (ordem cronológica)
  - `type MemorySubject = 'luis' | 'esposa' | 'casal'`; `type MemoryType = 'preference' | 'habit' | 'fact' | 'decision' | 'person'`; `type Memory = { id: string; subject: MemorySubject; type: MemoryType; content: string }`; `insertMemory`, `searchMemories(embedding, subjects, count?)`, `updateMemoryContent(id, content, embedding)`, `expireMemory(id)`, `listActiveMemories(cap?)`
  - `getState<T>(key: string): Promise<T | null>`; `setState(key: string, value: unknown): Promise<void>`

(Sem testes unitários: são wrappers finos de IO sobre o supabase-js; a lógica que os consome é testada com fakes nas Tasks 5, 8, 9 e 10. Gate: typecheck + smoke E2E na Task 12.)

- [ ] **Step 1: Implementar `db/usage.ts`**

```ts
import { supabase } from './client.js';

export type UsageRow = {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
};

export async function recordUsage(u: UsageRow): Promise<void> {
  const { error } = await supabase.from('llm_usage').insert({
    model: u.model,
    purpose: u.purpose,
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cost_brl: u.costBrl,
  });
  if (error) throw error;
}

export async function getMonthCostBrl(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('llm_usage')
    .select('cost_brl')
    .gte('created_at', start.toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_brl), 0);
}
```

- [ ] **Step 2: Implementar `db/chats.ts`**

```ts
import { supabase } from './client.js';

export type ChatIdentity = {
  chatId: number;
  kind: 'private' | 'group';
  userName: string | null;
  subject: 'luis' | 'esposa' | null;
};

export async function getChatIdentity(chatId: number): Promise<ChatIdentity | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id, kind, users ( name, subject )')
    .eq('id', chatId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  return {
    chatId: Number(data.id),
    kind: data.kind as 'private' | 'group',
    userName: user?.name ?? null,
    subject: (user?.subject as 'luis' | 'esposa' | undefined) ?? null,
  };
}
```

- [ ] **Step 3: Implementar `db/messages.ts`**

```ts
import { supabase } from './client.js';

export type ChatRole = 'user' | 'assistant';

export async function saveMessage(m: {
  chatId: number;
  role: ChatRole;
  content: string;
}): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .insert({ chat_id: m.chatId, role: m.role, content: m.content });
  if (error) throw error;
}

export async function getRecentMessages(
  chatId: number,
  limit = 20,
): Promise<{ role: ChatRole; content: string }[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse().map((r) => ({ role: r.role as ChatRole, content: r.content }));
}

export async function getMessagesSince(
  sinceIso: string,
): Promise<{ chatId: number; role: ChatRole; content: string; createdAt: string }[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('chat_id, role, content, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    chatId: Number(r.chat_id),
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}
```

- [ ] **Step 4: Implementar `db/memories.ts`**

```ts
import { supabase } from './client.js';

export type MemorySubject = 'luis' | 'esposa' | 'casal';
export type MemoryType = 'preference' | 'habit' | 'fact' | 'decision' | 'person';

export type Memory = {
  id: string;
  subject: MemorySubject;
  type: MemoryType;
  content: string;
};

export async function insertMemory(m: {
  subject: MemorySubject;
  type: MemoryType;
  content: string;
  embedding: number[];
  source: string;
}): Promise<void> {
  const { error } = await supabase.from('memories').insert({
    subject: m.subject,
    type: m.type,
    content: m.content,
    embedding: m.embedding,
    source: m.source,
  });
  if (error) throw error;
}

export async function searchMemories(
  embedding: number[],
  subjects: MemorySubject[],
  count = 6,
): Promise<Memory[]> {
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    subjects,
    match_count: count,
  });
  if (error) throw error;
  return (data ?? []).map((r: { id: string; subject: string; type: string; content: string }) => ({
    id: r.id,
    subject: r.subject as MemorySubject,
    type: r.type as MemoryType,
    content: r.content,
  }));
}

export async function updateMemoryContent(
  id: string,
  content: string,
  embedding: number[],
): Promise<void> {
  const { error } = await supabase
    .from('memories')
    .update({ content, embedding, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function expireMemory(id: string): Promise<void> {
  const { error } = await supabase.from('memories').update({ active: false }).eq('id', id);
  if (error) throw error;
}

export async function listActiveMemories(cap = 200): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, subject, type, content')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return (data ?? []) as Memory[];
}
```

- [ ] **Step 5: Implementar `db/state.ts`**

```ts
import { supabase } from './client.js';

export async function getState<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return (data?.value as T) ?? null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from('app_state').upsert({ key, value });
  if (error) throw error;
}
```

- [ ] **Step 6: Typecheck e commit**

Run: `npm run typecheck`
Expected: limpo.

```bash
git add -A
git commit -m "feat: repositórios de dados (usage, chats, messages, memories, state)"
```

---

### Task 5: Camada de modelos (roteador + wrapper com custo)

**Files:**
- Create: `apps/server/src/agent/models.ts`
- Test: `apps/server/src/agent/models.test.ts`

**Interfaces:**
- Consumes: `estimateCostBrl`, `budgetStatus`/`BudgetStatus`, `UsageRow`, `recordUsage`, `getMonthCostBrl`, `getConfig`.
- Produces:
  - `type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding'`
  - `pickModelId(purpose: Purpose, status: BudgetStatus, cfg: Config): string`
  - `type LlmDeps = { createModel: (modelId: string) => LanguageModel; record: (u: UsageRow) => Promise<void>; monthCost: () => Promise<number> }`; `defaultLlmDeps(): LlmDeps`
  - `generateAgentText(opts: { purpose: Purpose; system: string; messages: ModelMessage[]; tools?: ToolSet; onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void> }, deps?: LlmDeps): Promise<string>`
  - `generateAgentObject<T>(opts: { purpose: Purpose; system: string; prompt: string; schema: z.Schema<T>; onBudgetAlert?: ... }, deps?: LlmDeps): Promise<T>`

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/agent/models.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV2 } from 'ai/test';
import { loadConfig } from '../lib/config.js';
import type { UsageRow } from '../db/usage.js';
import { generateAgentText, pickModelId, type LlmDeps } from './models.js';

const cfg = loadConfig({
  TELEGRAM_TOKEN: 't',
  OPENAI_API_KEY: 'k',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
} as NodeJS.ProcessEnv);

function mockModel(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      content: [{ type: 'text', text }],
      warnings: [],
    }),
  });
}

function makeDeps(recorded: UsageRow[], monthCostBrl: number, replyText = 'oi!'): LlmDeps {
  return {
    createModel: () => mockModel(replyText),
    record: async (u) => {
      recorded.push(u);
    },
    monthCost: async () => monthCostBrl,
  };
}

describe('pickModelId', () => {
  it('chat usa o modelo default', () => {
    expect(pickModelId('chat', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
  it('briefing e analysis usam o modelo forte', () => {
    expect(pickModelId('briefing', 'ok', cfg)).toBe(cfg.MODEL_STRONG_ID);
    expect(pickModelId('analysis', 'warn', cfg)).toBe(cfg.MODEL_STRONG_ID);
  });
  it('orçamento estourado degrada tudo para o default', () => {
    expect(pickModelId('briefing', 'exceeded', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
});

describe('generateAgentText', () => {
  it('retorna o texto e registra o uso', async () => {
    const recorded: UsageRow[] = [];
    const text = await generateAgentText(
      { purpose: 'chat', system: 'sys', messages: [{ role: 'user', content: 'olá' }] },
      makeDeps(recorded, 0),
    );
    expect(text).toBe('oi!');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].purpose).toBe('chat');
    expect(recorded[0].inputTokens).toBe(100);
    expect(recorded[0].costBrl).toBeGreaterThan(0);
  });

  it('dispara onBudgetAlert quando o status não é ok', async () => {
    const alerts: string[] = [];
    await generateAgentText(
      {
        purpose: 'chat',
        system: 'sys',
        messages: [{ role: 'user', content: 'olá' }],
        onBudgetAlert: async (status) => {
          alerts.push(status);
        },
      },
      makeDeps([], 45), // 45 >= 80% de 50
    );
    expect(alerts).toEqual(['warn']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `./models.js` não existe.

- [ ] **Step 3: Implementar `agent/models.ts`**

```ts
import { createOpenAI } from '@ai-sdk/openai';
import {
  generateObject,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';
import { budgetStatus, type BudgetStatus } from '../lib/budget.js';
import { getConfig, type Config } from '../lib/config.js';
import { estimateCostBrl } from '../lib/pricing.js';
import { getMonthCostBrl, recordUsage, type UsageRow } from '../db/usage.js';

export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding';

const STRONG_PURPOSES: ReadonlySet<Purpose> = new Set(['briefing', 'analysis']);

export function pickModelId(purpose: Purpose, status: BudgetStatus, cfg: Config): string {
  if (status !== 'exceeded' && STRONG_PURPOSES.has(purpose)) return cfg.MODEL_STRONG_ID;
  return cfg.MODEL_DEFAULT_ID;
}

export type LlmDeps = {
  createModel: (modelId: string) => LanguageModel;
  record: (u: UsageRow) => Promise<void>;
  monthCost: () => Promise<number>;
};

export function defaultLlmDeps(): LlmDeps {
  const cfg = getConfig();
  const openai = createOpenAI({ apiKey: cfg.OPENAI_API_KEY });
  return { createModel: (id) => openai(id), record: recordUsage, monthCost: getMonthCostBrl };
}

type CommonOpts = {
  purpose: Purpose;
  onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void>;
};

async function prepare(opts: CommonOpts, deps: LlmDeps) {
  const cfg = getConfig();
  const monthCost = await deps.monthCost();
  const status = budgetStatus(monthCost, cfg.LLM_BUDGET_BRL);
  if (status !== 'ok' && opts.onBudgetAlert) await opts.onBudgetAlert(status, monthCost);
  return { cfg, modelId: pickModelId(opts.purpose, status, cfg) };
}

async function record(
  deps: LlmDeps,
  cfg: Config,
  modelId: string,
  purpose: Purpose,
  usage: { inputTokens?: number; outputTokens?: number },
) {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  await deps.record({
    model: modelId,
    purpose,
    inputTokens,
    outputTokens,
    costBrl: estimateCostBrl(modelId, inputTokens, outputTokens, cfg.USD_BRL_RATE),
  });
}

export async function generateAgentText(
  opts: CommonOpts & { system: string; messages: ModelMessage[]; tools?: ToolSet },
  deps: LlmDeps = defaultLlmDeps(),
): Promise<string> {
  const { cfg, modelId } = await prepare(opts, deps);
  const result = await generateText({
    model: deps.createModel(modelId),
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: stepCountIs(8),
  });
  await record(deps, cfg, modelId, opts.purpose, result.usage);
  return result.text;
}

export async function generateAgentObject<T>(
  opts: CommonOpts & { system: string; prompt: string; schema: z.Schema<T> },
  deps: LlmDeps = defaultLlmDeps(),
): Promise<T> {
  const { cfg, modelId } = await prepare(opts, deps);
  const result = await generateObject({
    model: deps.createModel(modelId),
    system: opts.system,
    prompt: opts.prompt,
    schema: opts.schema,
  });
  await record(deps, cfg, modelId, opts.purpose, result.usage);
  return result.object;
}
```

- [ ] **Step 4: Rodar testes**

Run: `npm test`
Expected: PASS. (Se `MockLanguageModelV2`/campos divergirem na versão instalada do `ai`, ajustar o mock do teste conforme docs do AI SDK v5 — a interface pública de `models.ts` não muda.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: roteador de modelos e wrapper de geração com registro de custo"
```

---

### Task 6: Embeddings + recall de memórias

**Files:**
- Create: `apps/server/src/memory/embeddings.ts`, `apps/server/src/memory/recall.ts`

**Interfaces:**
- Consumes: `getConfig`, `estimateCostBrl`, `recordUsage`, `searchMemories`, `Memory`, `MemorySubject`.
- Produces: `embedText(text: string): Promise<number[]>`; `recallMemories(text: string, subjects: MemorySubject[]): Promise<Memory[]>`.

(Wrappers finos; testados indiretamente via Task 8 com fakes. Gate: typecheck.)

- [ ] **Step 1: Implementar `memory/embeddings.ts`**

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import { getConfig } from '../lib/config.js';
import { estimateCostBrl } from '../lib/pricing.js';
import { recordUsage } from '../db/usage.js';

export async function embedText(text: string): Promise<number[]> {
  const cfg = getConfig();
  const openai = createOpenAI({ apiKey: cfg.OPENAI_API_KEY });
  const { embedding, usage } = await embed({
    model: openai.textEmbedding(cfg.EMBEDDING_MODEL_ID),
    value: text,
  });
  const tokens = usage?.tokens ?? 0;
  await recordUsage({
    model: cfg.EMBEDDING_MODEL_ID,
    purpose: 'embedding',
    inputTokens: tokens,
    outputTokens: 0,
    costBrl: estimateCostBrl(cfg.EMBEDDING_MODEL_ID, tokens, 0, cfg.USD_BRL_RATE),
  });
  return embedding;
}
```

- [ ] **Step 2: Implementar `memory/recall.ts`**

```ts
import { searchMemories, type Memory, type MemorySubject } from '../db/memories.js';
import { embedText } from './embeddings.js';

export async function recallMemories(
  text: string,
  subjects: MemorySubject[],
): Promise<Memory[]> {
  const embedding = await embedText(text);
  return searchMemories(embedding, subjects, 6);
}
```

- [ ] **Step 3: Typecheck e commit**

Run: `npm run typecheck`
Expected: limpo.

```bash
git add -A
git commit -m "feat: embeddings e recall semântico de memórias"
```

---

### Task 7: Prompts por contexto de chat

**Files:**
- Create: `apps/server/src/agent/prompts.ts`
- Test: `apps/server/src/agent/prompts.test.ts`

**Interfaces:**
- Consumes: `ChatIdentity`, `Memory`, `MemorySubject`.
- Produces: `subjectsForChat(identity: ChatIdentity): MemorySubject[]`; `buildSystemPrompt(args: { identity: ChatIdentity; memories: Memory[]; now: Date; timezone: string }): string`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/agent/prompts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildSystemPrompt, subjectsForChat } from './prompts.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const esposa: ChatIdentity = { chatId: 2, kind: 'private', userName: 'Esposa', subject: 'esposa' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

describe('subjectsForChat', () => {
  it('privado do Luis vê luis + casal', () =>
    expect(subjectsForChat(luis)).toEqual(['luis', 'casal']));
  it('privado da esposa vê esposa + casal', () =>
    expect(subjectsForChat(esposa)).toEqual(['esposa', 'casal']));
  it('grupo vê tudo', () =>
    expect(subjectsForChat(grupo)).toEqual(['luis', 'esposa', 'casal']));
});

describe('buildSystemPrompt', () => {
  const args = {
    identity: luis,
    memories: [{ id: 'm1', subject: 'luis' as const, type: 'preference' as const, content: 'Prefere reuniões à tarde' }],
    now: new Date('2026-07-08T12:00:00Z'),
    timezone: 'America/Sao_Paulo',
  };

  it('inclui nome do usuário, memórias e data', () => {
    const p = buildSystemPrompt(args);
    expect(p).toContain('Luis');
    expect(p).toContain('Prefere reuniões à tarde');
    expect(p).toContain('2026');
  });

  it('no grupo, instrui a distinguir quem fala', () => {
    const p = buildSystemPrompt({ ...args, identity: grupo, memories: [] });
    expect(p.toLowerCase()).toContain('grupo');
  });

  it('sem memórias, não inclui bloco vazio de memórias', () => {
    const p = buildSystemPrompt({ ...args, memories: [] });
    expect(p).not.toContain('O que você sabe');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `./prompts.js` não existe.

- [ ] **Step 3: Implementar `agent/prompts.ts`**

```ts
import type { ChatIdentity } from '../db/chats.js';
import type { Memory, MemorySubject } from '../db/memories.js';

export function subjectsForChat(identity: ChatIdentity): MemorySubject[] {
  if (identity.kind === 'group') return ['luis', 'esposa', 'casal'];
  if (identity.subject === 'luis') return ['luis', 'casal'];
  return ['esposa', 'casal'];
}

export function buildSystemPrompt(args: {
  identity: ChatIdentity;
  memories: Memory[];
  now: Date;
  timezone: string;
}): string {
  const { identity, memories, now, timezone } = args;
  const dateStr = now.toLocaleString('pt-BR', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' });

  const who =
    identity.kind === 'group'
      ? 'Você está no grupo do casal (Luis e esposa). As mensagens vêm prefixadas com o nome de quem fala — responda levando em conta quem pediu.'
      : `Você está no chat privado de ${identity.userName}.`;

  const memoryBlock =
    memories.length > 0
      ? `\n\nO que você sabe (memórias relevantes):\n${memories
          .map((m) => `- [${m.subject}/${m.type}] ${m.content}`)
          .join('\n')}`
      : '';

  return `Você é o assistente pessoal do Luis e da esposa dele. Converse em português brasileiro, com naturalidade e concisão — nada de tom corporativo.

${who}

Agora é ${dateStr} (${timezone}).

Regras:
- Quando o usuário disser algo durável sobre si, preferências, hábitos, decisões ou pessoas ("sempre", "nunca", "prefiro", "decidi"), use a tool save_memory para registrar.
- Se não tiver certeza do que a pessoa quis dizer, pergunte em vez de supor.
- Não invente informações; se não sabe, diga que não sabe.${memoryBlock}`;
}
```

- [ ] **Step 4: Rodar testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: prompts por contexto de chat com memórias"
```

---

### Task 8: Agente (handleMessage) + tool save_memory

**Files:**
- Create: `apps/server/src/agent/agent.ts`
- Test: `apps/server/src/agent/agent.test.ts`

**Interfaces:**
- Consumes: `ChatIdentity`/`getChatIdentity`, `saveMessage`, `getRecentMessages`, `recallMemories`, `generateAgentText`, `subjectsForChat`, `buildSystemPrompt`, `insertMemory`, `embedText`, `getConfig`.
- Produces:
  - `type AgentDeps = { getChatIdentity; saveMessage; getRecentMessages; recall; generate; tools: ToolSet; onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void> }` (assinaturas iguais às consumidas)
  - `defaultAgentDeps(onBudgetAlert?): AgentDeps`
  - `buildTools(): ToolSet` — contém `save_memory`
  - `handleMessage(msg: { chatId: number; text: string }, deps?: AgentDeps): Promise<string | null>` — `null` se chat não cadastrado.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/agent/agent.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import type { ChatRole } from '../db/messages.js';
import { handleMessage, type AgentDeps } from './agent.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function makeDeps(identity: ChatIdentity | null) {
  const saved: { chatId: number; role: ChatRole; content: string }[] = [];
  const deps: AgentDeps = {
    getChatIdentity: async () => identity,
    saveMessage: async (m) => {
      saved.push(m);
    },
    getRecentMessages: async () => [{ role: 'user', content: 'oi' }],
    recall: async () => [],
    generate: async (opts) => {
      // o agente deve mandar system prompt e o histórico + mensagem nova
      expect(opts.system.length).toBeGreaterThan(0);
      expect(opts.messages.at(-1)).toEqual({ role: 'user', content: 'qual meu nome?' });
      return 'Você é o Luis!';
    },
    tools: {},
  };
  return { deps, saved };
}

describe('handleMessage', () => {
  it('retorna null para chat não cadastrado', async () => {
    const { deps } = makeDeps(null);
    expect(await handleMessage({ chatId: 99, text: 'oi' }, deps)).toBeNull();
  });

  it('persiste a mensagem do usuário e a resposta', async () => {
    const { deps, saved } = makeDeps(luis);
    const reply = await handleMessage({ chatId: 1, text: 'qual meu nome?' }, deps);
    expect(reply).toBe('Você é o Luis!');
    expect(saved).toEqual([
      { chatId: 1, role: 'user', content: 'qual meu nome?' },
      { chatId: 1, role: 'assistant', content: 'Você é o Luis!' },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `./agent.js` não existe.

- [ ] **Step 3: Implementar `agent/agent.ts`**

```ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { BudgetStatus } from '../lib/budget.js';
import { getConfig } from '../lib/config.js';
import { getChatIdentity, type ChatIdentity } from '../db/chats.js';
import { getRecentMessages, saveMessage, type ChatRole } from '../db/messages.js';
import { insertMemory, type Memory, type MemorySubject } from '../db/memories.js';
import { embedText } from '../memory/embeddings.js';
import { recallMemories } from '../memory/recall.js';
import { generateAgentText } from './models.js';
import { buildSystemPrompt, subjectsForChat } from './prompts.js';

export type AgentDeps = {
  getChatIdentity: (chatId: number) => Promise<ChatIdentity | null>;
  saveMessage: (m: { chatId: number; role: ChatRole; content: string }) => Promise<void>;
  getRecentMessages: (chatId: number, limit?: number) => Promise<{ role: ChatRole; content: string }[]>;
  recall: (text: string, subjects: MemorySubject[]) => Promise<Memory[]>;
  generate: typeof generateAgentText;
  tools: ToolSet;
  onBudgetAlert?: (status: BudgetStatus, monthCostBrl: number) => Promise<void>;
};

export function buildTools(): ToolSet {
  return {
    save_memory: tool({
      description:
        'Salva um fato durável sobre o usuário, o casal ou pessoas próximas (preferência, hábito, fato, decisão, pessoa). Use quando o usuário declarar algo que vale lembrar para sempre.',
      inputSchema: z.object({
        subject: z.enum(['luis', 'esposa', 'casal']),
        type: z.enum(['preference', 'habit', 'fact', 'decision', 'person']),
        content: z.string().describe('O fato, em uma frase autossuficiente em PT-BR'),
      }),
      execute: async ({ subject, type, content }) => {
        await insertMemory({ subject, type, content, embedding: await embedText(content), source: 'tool' });
        return 'Memória salva.';
      },
    }),
  };
}

export function defaultAgentDeps(
  onBudgetAlert?: AgentDeps['onBudgetAlert'],
): AgentDeps {
  return {
    getChatIdentity,
    saveMessage,
    getRecentMessages,
    recall: recallMemories,
    generate: generateAgentText,
    tools: buildTools(),
    onBudgetAlert,
  };
}

export async function handleMessage(
  msg: { chatId: number; text: string },
  deps: AgentDeps = defaultAgentDeps(),
): Promise<string | null> {
  const identity = await deps.getChatIdentity(msg.chatId);
  if (!identity) return null;

  await deps.saveMessage({ chatId: msg.chatId, role: 'user', content: msg.text });

  const [history, memories] = await Promise.all([
    deps.getRecentMessages(msg.chatId, 20),
    deps.recall(msg.text, subjectsForChat(identity)),
  ]);

  const cfg = getConfig();
  const system = buildSystemPrompt({ identity, memories, now: new Date(), timezone: cfg.TIMEZONE });

  // histórico já inclui a mensagem recém-salva em produção; em fakes pode não incluir —
  // garante que a última mensagem é a atual sem duplicar
  const past = history.filter((_, i) => i < history.length - 1 || history.at(-1)?.content !== msg.text);
  const reply = await deps.generate({
    purpose: 'chat',
    system,
    messages: [...past, { role: 'user', content: msg.text }],
    tools: deps.tools,
    onBudgetAlert: deps.onBudgetAlert,
  });

  await deps.saveMessage({ chatId: msg.chatId, role: 'assistant', content: reply });
  return reply;
}
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / limpo.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: loop do agente com recall de memórias e tool save_memory"
```

---

### Task 9: Reflexão noturna

**Files:**
- Create: `apps/server/src/memory/reflection.ts`
- Test: `apps/server/src/memory/reflection.test.ts`

**Interfaces:**
- Consumes: `generateAgentObject`, `getMessagesSince`, `listActiveMemories`, `insertMemory`, `updateMemoryContent`, `expireMemory`, `embedText`, `getState`/`setState`.
- Produces:
  - `reflectionOutputSchema` (zod) → `type ReflectionOp = { action: 'add'; subject: MemorySubject; type: MemoryType; content: string } | { action: 'update'; id: string; content: string } | { action: 'expire'; id: string }`
  - `type ReflectionRepo = { insert: (op: add) => Promise<void>; update: (id: string, content: string) => Promise<void>; expire: (id: string) => Promise<void> }`
  - `applyOps(ops: ReflectionOp[], repo: ReflectionRepo): Promise<{ added: number; updated: number; expired: number }>`
  - `runReflection(deps?): Promise<{ added: number; updated: number; expired: number }>`

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/memory/reflection.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyOps, reflectionOutputSchema, type ReflectionOp } from './reflection.js';

describe('reflectionOutputSchema', () => {
  it('aceita saída válida do modelo', () => {
    const parsed = reflectionOutputSchema.parse({
      ops: [
        { action: 'add', subject: 'luis', type: 'preference', content: 'Prefere café sem açúcar' },
        { action: 'update', id: 'abc', content: 'Paga a fatura dia 6' },
        { action: 'expire', id: 'def' },
      ],
    });
    expect(parsed.ops).toHaveLength(3);
  });

  it('rejeita action desconhecida', () => {
    expect(() => reflectionOutputSchema.parse({ ops: [{ action: 'delete', id: 'x' }] })).toThrow();
  });
});

describe('applyOps', () => {
  it('aplica cada operação no repositório e conta', async () => {
    const calls: string[] = [];
    const ops: ReflectionOp[] = [
      { action: 'add', subject: 'casal', type: 'decision', content: 'Vão viajar em setembro' },
      { action: 'expire', id: 'old1' },
    ];
    const result = await applyOps(ops, {
      insert: async (op) => {
        calls.push(`insert:${op.content}`);
      },
      update: async (id, content) => {
        calls.push(`update:${id}:${content}`);
      },
      expire: async (id) => {
        calls.push(`expire:${id}`);
      },
    });
    expect(calls).toEqual(['insert:Vão viajar em setembro', 'expire:old1']);
    expect(result).toEqual({ added: 1, updated: 0, expired: 1 });
  });

  it('uma operação com erro não derruba as demais', async () => {
    const ops: ReflectionOp[] = [
      { action: 'expire', id: 'boom' },
      { action: 'add', subject: 'luis', type: 'fact', content: 'Trabalha com projetos de IA' },
    ];
    const result = await applyOps(ops, {
      insert: async () => {},
      update: async () => {},
      expire: async () => {
        throw new Error('não existe');
      },
    });
    expect(result).toEqual({ added: 1, updated: 0, expired: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `./reflection.js` não existe.

- [ ] **Step 3: Implementar `memory/reflection.ts`**

```ts
import { z } from 'zod';
import { getMessagesSince } from '../db/messages.js';
import {
  expireMemory,
  insertMemory,
  listActiveMemories,
  updateMemoryContent,
  type MemorySubject,
  type MemoryType,
} from '../db/memories.js';
import { getState, setState } from '../db/state.js';
import { generateAgentObject } from '../agent/models.js';
import { embedText } from './embeddings.js';

export const reflectionOutputSchema = z.object({
  ops: z.array(
    z.discriminatedUnion('action', [
      z.object({
        action: z.literal('add'),
        subject: z.enum(['luis', 'esposa', 'casal']),
        type: z.enum(['preference', 'habit', 'fact', 'decision', 'person']),
        content: z.string(),
      }),
      z.object({ action: z.literal('update'), id: z.string(), content: z.string() }),
      z.object({ action: z.literal('expire'), id: z.string() }),
    ]),
  ),
});

export type ReflectionOp = z.infer<typeof reflectionOutputSchema>['ops'][number];

export type ReflectionRepo = {
  insert: (op: Extract<ReflectionOp, { action: 'add' }>) => Promise<void>;
  update: (id: string, content: string) => Promise<void>;
  expire: (id: string) => Promise<void>;
};

export async function applyOps(
  ops: ReflectionOp[],
  repo: ReflectionRepo,
): Promise<{ added: number; updated: number; expired: number }> {
  const result = { added: 0, updated: 0, expired: 0 };
  for (const op of ops) {
    try {
      if (op.action === 'add') {
        await repo.insert(op);
        result.added++;
      } else if (op.action === 'update') {
        await repo.update(op.id, op.content);
        result.updated++;
      } else {
        await repo.expire(op.id);
        result.expired++;
      }
    } catch (err) {
      console.error('[reflection] op falhou', op, err);
    }
  }
  return result;
}

const STATE_KEY = 'last_reflection_at';
const SYSTEM = `Você mantém a memória de longo prazo de um assistente pessoal de um casal (Luis e esposa).
Analise as conversas do dia e as memórias existentes e produza operações:
- add: fato durável NOVO (preferência, hábito, fato, decisão, pessoa). Frases autossuficientes em PT-BR. Nada efêmero (compromissos pontuais, small talk).
- update: memória existente cujo conteúdo mudou (use o id dela).
- expire: memória existente que ficou obsoleta ou foi contradita.
Inclua também preferências sobre a conduta do assistente (ex.: "não avisar sobre X").
Se nada durável aconteceu, retorne ops vazio.`;

export async function runReflection(deps = {
  getMessagesSince,
  listActiveMemories,
  getState,
  setState,
  generate: generateAgentObject,
  repo: {
    insert: async (op: Extract<ReflectionOp, { action: 'add' }>) =>
      insertMemory({
        subject: op.subject as MemorySubject,
        type: op.type as MemoryType,
        content: op.content,
        embedding: await embedText(op.content),
        source: 'reflection',
      }),
    update: async (id: string, content: string) =>
      updateMemoryContent(id, content, await embedText(content)),
    expire: expireMemory,
  } satisfies ReflectionRepo,
}): Promise<{ added: number; updated: number; expired: number }> {
  const since =
    (await deps.getState<string>(STATE_KEY)) ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const messages = await deps.getMessagesSince(since);
  const startedAt = new Date().toISOString();

  if (messages.length === 0) {
    await deps.setState(STATE_KEY, startedAt);
    return { added: 0, updated: 0, expired: 0 };
  }

  const existing = await deps.listActiveMemories(200);
  const prompt = `MEMÓRIAS EXISTENTES:\n${existing
    .map((m) => `${m.id} [${m.subject}/${m.type}] ${m.content}`)
    .join('\n') || '(nenhuma)'}\n\nCONVERSAS DESDE ${since}:\n${messages
    .map((m) => `[chat ${m.chatId}] ${m.role}: ${m.content}`)
    .join('\n')}`;

  const output = await deps.generate({
    purpose: 'reflection',
    system: SYSTEM,
    prompt,
    schema: reflectionOutputSchema,
  });

  const result = await applyOps(output.ops, deps.repo);
  await deps.setState(STATE_KEY, startedAt);
  console.log('[reflection]', result);
  return result;
}
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / limpo.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: job de reflexão noturna destila conversas em memórias"
```

---

### Task 10: Bot Telegram + alerta de orçamento

**Files:**
- Create: `apps/server/src/bot/bot.ts`, `apps/server/src/lib/alerts.ts`
- Test: `apps/server/src/lib/alerts.test.ts`

**Interfaces:**
- Consumes: `handleMessage`, `getState`/`setState`, `BudgetStatus`.
- Produces:
  - `createBot(token: string, handle: (msg: { chatId: number; text: string }) => Promise<string | null>): Bot`
  - `createBudgetAlert(deps: { send: (text: string) => Promise<void>; getState; setState }): (status: BudgetStatus, monthCostBrl: number) => Promise<void>` — avisa 1x por mês por nível.

- [ ] **Step 1: Teste do alerta (falhando)**

`apps/server/src/lib/alerts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createBudgetAlert } from './alerts.js';

function makeAlert() {
  const sent: string[] = [];
  const state = new Map<string, unknown>();
  const alert = createBudgetAlert({
    send: async (text) => {
      sent.push(text);
    },
    getState: async (key) => (state.get(key) as never) ?? null,
    setState: async (key, value) => {
      state.set(key, value);
    },
  });
  return { alert, sent };
}

describe('createBudgetAlert', () => {
  it('avisa uma vez no warn e não repete no mesmo mês', async () => {
    const { alert, sent } = makeAlert();
    await alert('warn', 41);
    await alert('warn', 43);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('80%');
  });

  it('exceeded gera aviso próprio mesmo depois do warn', async () => {
    const { alert, sent } = makeAlert();
    await alert('warn', 41);
    await alert('exceeded', 51);
    expect(sent).toHaveLength(2);
    expect(sent[1].toLowerCase()).toContain('modelo');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `./alerts.js` não existe.

- [ ] **Step 3: Implementar `lib/alerts.ts`**

```ts
import type { BudgetStatus } from './budget.js';

type AlertDeps = {
  send: (text: string) => Promise<void>;
  getState: <T>(key: string) => Promise<T | null>;
  setState: (key: string, value: unknown) => Promise<void>;
};

export function createBudgetAlert(deps: AlertDeps) {
  return async (status: BudgetStatus, monthCostBrl: number): Promise<void> => {
    if (status === 'ok') return;
    const month = new Date().toISOString().slice(0, 7); // ex.: 2026-07
    const key = `budget_alert_${status}_${month}`;
    if (await deps.getState(key)) return;
    await deps.setState(key, true);
    const cost = monthCostBrl.toFixed(2);
    const text =
      status === 'warn'
        ? `⚠️ Orçamento de IA: já usei R$ ${cost} este mês (≥80% do teto). Vou seguir normal, mas fica o aviso.`
        : `🛑 Orçamento de IA estourado (R$ ${cost}). Passei a usar só o modelo econômico até o fim do mês.`;
    await deps.send(text);
  };
}
```

- [ ] **Step 4: Implementar `bot/bot.ts`**

```ts
import { Bot } from 'grammy';

export function createBot(
  token: string,
  handle: (msg: { chatId: number; text: string }) => Promise<string | null>,
): Bot {
  const bot = new Bot(token);

  // /id funciona em qualquer chat, mesmo não cadastrado (necessário para o setup)
  bot.command('id', (ctx) => ctx.reply(`chat_id: ${ctx.chat.id}`));

  bot.on('message:text', async (ctx) => {
    // no grupo, prefixa quem falou para o agente (e a reflexão) saberem
    const text =
      ctx.chat.type === 'private'
        ? ctx.message.text
        : `${ctx.from?.first_name ?? 'Alguém'}: ${ctx.message.text}`;
    try {
      await ctx.replyWithChatAction('typing');
      const reply = await handle({ chatId: ctx.chat.id, text });
      if (reply) await ctx.reply(reply); // null = chat não cadastrado → ignora em silêncio
    } catch (err) {
      console.error('[bot]', err);
      await ctx.reply('Tive um problema aqui do meu lado. Tenta de novo?').catch(() => {});
    }
  });

  bot.catch((err) => console.error('[bot:unhandled]', err));
  return bot;
}
```

- [ ] **Step 5: Rodar testes e typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / limpo.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: bot Telegram com whitelist implícita e alerta de orçamento"
```

---

### Task 11: Scheduler + bootstrap + script de reflexão manual

**Files:**
- Create: `apps/server/src/jobs/scheduler.ts`, `apps/server/src/index.ts`, `apps/server/src/scripts/run-reflection.ts`

**Interfaces:**
- Consumes: `getConfig`, `createBot`, `defaultAgentDeps`, `handleMessage`, `runReflection`, `createBudgetAlert`, `getState`/`setState`, `supabase`.
- Produces: processo executável (`npm run dev`) e `npm run job:reflect`.

- [ ] **Step 1: Implementar `jobs/scheduler.ts`**

```ts
import cron from 'node-cron';
import { getConfig } from '../lib/config.js';
import { runReflection } from '../memory/reflection.js';

export function startScheduler(): void {
  const cfg = getConfig();
  cron.schedule(
    '0 3 * * *',
    () => {
      runReflection().catch((err) => console.error('[job:reflection]', err));
    },
    { timezone: cfg.TIMEZONE },
  );
  console.log(`[scheduler] reflexão diária às 03:00 ${cfg.TIMEZONE}`);
}
```

- [ ] **Step 2: Implementar `index.ts`**

```ts
import { getConfig } from './lib/config.js';
import { createBudgetAlert } from './lib/alerts.js';
import { supabase } from './db/client.js';
import { getState, setState } from './db/state.js';
import { defaultAgentDeps, handleMessage } from './agent/agent.js';
import { createBot } from './bot/bot.js';
import { startScheduler } from './jobs/scheduler.js';

async function main() {
  const cfg = getConfig();

  const bot = createBot(cfg.TELEGRAM_TOKEN, (msg) => handleMessage(msg, agentDeps));

  const sendToLuis = async (text: string) => {
    const { data } = await supabase
      .from('users')
      .select('telegram_chat_id')
      .eq('subject', 'luis')
      .maybeSingle();
    if (data) await bot.api.sendMessage(Number(data.telegram_chat_id), text);
  };
  const agentDeps = defaultAgentDeps(createBudgetAlert({ send: sendToLuis, getState, setState }));

  startScheduler();
  console.log('[bot] iniciando long polling…');
  await bot.start();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
```

- [ ] **Step 3: Implementar `scripts/run-reflection.ts`**

```ts
import { runReflection } from '../memory/reflection.js';

runReflection()
  .then((r) => {
    console.log('reflexão concluída:', r);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 4: Typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: limpo; `apps/server/dist/index.js` gerado.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scheduler, bootstrap e script de reflexão manual"
```

---

### Task 12: Docker + deploy + smoke test E2E (UAT)

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `DEPLOY.md`

- [ ] **Step 1: Escrever `Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/server apps/server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
CMD ["node", "apps/server/dist/index.js"]
```

- [ ] **Step 2: Escrever `docker-compose.yml`**

```yaml
services:
  assistente-v2:
    build: .
    env_file: .env
    restart: unless-stopped
```

- [ ] **Step 3: Escrever `DEPLOY.md`**

```markdown
# Deploy (VPS Hostinger, ao lado da v1)

1. Pré-requisito: SETUP.md concluído (.env preenchido, migração rodada, users/chats cadastrados).
2. `git clone <repo> assistente-pessoal-v2 && cd assistente-pessoal-v2`
3. Copiar o `.env` para o servidor (nunca commitar).
4. `docker compose up -d --build`
5. Logs: `docker compose logs -f assistente-v2`
6. Atualizar: `git pull && docker compose up -d --build`
```

- [ ] **Step 4: Smoke test local antes do deploy**

Com `.env` preenchido e SETUP feito:
Run: `npm run dev`
Checklist manual (UAT — critério de aceite da Fase 1):
1. `/id` responde em qualquer chat.
2. Mensagem de chat não cadastrado é ignorada (sem resposta).
3. No seu privado: "Oi! Lembre que eu sempre pago a fatura do cartão no dia 5." → responde e salva memória (verificar no Supabase: `select * from memories`).
4. "O que você sabe sobre mim?" → menciona a fatura do dia 5.
5. `npm run job:reflect` roda sem erro após algumas conversas e cria/atualiza memórias plausíveis.
6. **Teste do dia seguinte** (ou após `job:reflect` + nova sessão): perguntar algo que dependa do que foi dito ontem → ele lembra.
7. `select * from llm_usage` mostra custo registrado em cada interação.

- [ ] **Step 5: Deploy no VPS e repetir o checklist pelo Telegram**

Run (no VPS): `docker compose up -d --build`
Expected: bot online; itens 1–7 do checklist passam em produção.

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "feat: Docker, deploy e checklist de aceite da Fase 1"
```

---

## Self-review (executado na escrita do plano)

- **Cobertura da spec (Fase 1)**: scaffold ✓ (T1), Supabase+pgvector ✓ (T2), bot whitelist ✓ (T10 — whitelist implícita: chat fora de `chats` → `getChatIdentity` null → ignorado), memória 3 camadas ✓ (curta T4/T8, longa T4/T6/T8, reflexão T9), roteador de modelos ✓ (T5), `llm_usage` + guarda ✓ (T3/T4/T5/T10), reflexão noturna ✓ (T9/T11), critério "lembrar amanhã" ✓ (UAT T12).
- **Placeholders**: nenhum — todo step de código traz o código completo.
- **Consistência de tipos**: nomes conferidos entre tasks (`UsageRow`, `ChatIdentity`, `Memory`, `MemorySubject`, `ReflectionOp`, `generateAgentText/Object`, `handleMessage`).
