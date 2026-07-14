# Fase 4 — Proatividade + Briefing Matinal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de proatividade completo — coletores de eventos (finanças, agenda, tarefas), julgamento por IA com memórias, regras de silêncio auditáveis em `event_queue`, e briefing matinal unificado às 07:00 com modelo forte (+ visão do casal no grupo aos sábados).

**Architecture:** Coletores rodam em cron e inserem eventos deduplicados em `event_queue` (status `pending`). Um ciclo (`runProactiveCycle`) julga os pendentes em lote com o modelo barato (+ memórias relevantes) — decisão `notify`/`briefing`/`ignore` com motivo gravado — e entrega os `notify` na hora, exceto se horário de silêncio ou teto diário estourado (aí viram `queued` e caem no briefing). O briefing das 07:00 cruza agenda do dia, tarefas, finanças do mês (só do Luis) e eventos guardados, e escreve análise curta e opinada com o modelo forte.

**Tech Stack:** Node 22, TypeScript ESM NodeNext, node-cron, grammY (`bot.api.sendMessage`), Vercel AI SDK v5 via `agent/models.ts` (`generateAgentObject` para julgamento, `generateAgentText` para briefing), Supabase PostgREST, vitest.

## Global Constraints

- Imports relativos SEMPRE terminam em `.js` (ESM NodeNext); ponto e vírgula; aspas simples; strings/comentários em PT-BR.
- Toda chamada de LLM passa por `generateAgentText`/`generateAgentObject` de `apps/server/src/agent/models.ts`. Julgamento usa o modelo DEFAULT (purpose `judgment`, fora de STRONG_PURPOSES); briefing usa o modelo FORTE (purpose `briefing`, já em STRONG_PURPOSES).
- Todo evento julgado fica auditável em `event_queue` com `decision`, `reason` e `target` (spec §4).
- Regras de respeito (spec §4): horário de silêncio default 22:00–07:00, máximo de notificações/dia por destino default 5; guardadas em `app_state` chave `proactivity_config` (UI de edição fica para a Fase 8).
- Mensagens ao usuário: PT-BR, datas `dd/mm`, valores via `formatBrl`, nunca UUIDs.
- Padrão de módulos: deps injetáveis com `defaultDeps` (como `tools/tasks.ts` e `services/bank-sync.ts`); jobs com try/catch por usuário (falha de um não derruba o outro).
- Testes: vitest da raiz (`npx vitest run <caminho>`); qualquer teste que importe (mesmo transitivamente) `db/client.ts` tem `import '../test-setup.js';` como PRIMEIRO import; fakes/deps injetadas, nunca rede.
- Crons existentes intocados: reflexão 03:00, revisão financeira 08:00 (ambos `cfg.TIMEZONE`).
- Novos crons: calendário `*/30 * * * *` (só se `hasGoogleCreds`), finanças `0 */2 * * *` (só se `isBankConfigured`), tarefas `30 6 * * *`, briefing `0 7 * * *`, briefing do casal `0 8 * * 6` — todos `cfg.TIMEZONE`.
- Fora de escopo da fase (spec): coletor de Gmail (Fase 5), hábitos (Fase 7), "fatura fechando" (precisa do endpoint de faturas do Banco MCP — backlog), UI de configuração (Fase 8).

### Interfaces já existentes que esta fase consome (verbatim do código atual)

- `db/chats.ts`: `getUserBySubject(subject): Promise<UserRecord | null>` com `UserRecord = { id; name; calendarId }`; `getSubjectChatId(subject): Promise<number | null>`.
- `db/tasks.ts`: `type Task = { id; title; status: 'open'|'done'; dueDate: string | null }`; `listTasks(userId, status?)`.
- `db/finance.ts`: `listCategories()`, `listTransactionsBetween(from, to)`, `listCommitments(onlyActive?)`, `type Category`, `type Transaction`, `type Commitment`.
- `db/state.ts`: `getState<T>(key)`, `setState(key, value)`.
- `tools/calendar.ts`: `type CalEvent = { id; title; start; end; allDay }`, `type CalendarApi`, `calendarApiFromGoogle(client, timezone)`, `zonedDayStartIso(date, tz)`, `zonedDayEndIso(date, tz)`.
- `lib/google.ts`: `hasGoogleCreds(cfg)`, `getCalendarClient(cfg)`.
- `lib/banco-mcp.ts`: `isBankConfigured()`.
- `lib/dates.ts`: `todayInTz(tz, now?)`, `addDays(isoDate, days)`. `lib/format.ts`: `formatBrl(v)`.
- `memory/recall.ts`: `recallMemories(text, subjects): Promise<Memory[]>` (Memory tem `.content`).
- `agent/models.ts`: `generateAgentText(opts: { purpose; system; messages; tools?; onBudgetAlert? }, deps?): Promise<string>`; `generateAgentObject(opts: { purpose; system; prompt; schema }, deps?): Promise<T>`; `type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize'`.
- `tools/finance.ts`: tool `finance_month_summary` contém hoje a agregação do mês inline (será extraída na Task 4).

---

### Task 1: Migração 0003 + camada de dados de eventos (`db/events.ts`)

**Files:**
- Create: `supabase/migrations/0003_fase4.sql`
- Create: `apps/server/src/db/events.ts`
- Modify: `apps/server/src/db/chats.ts` (adicionar `getGroupChatId`)

**Interfaces:**
- Consumes: `supabase` de `./client.js`.
- Produces (usadas pelas Tasks 3, 5, 6, 7, 8, 9):
  - Tipos: `EventSource = 'finance' | 'calendar' | 'tasks'`, `EventDecision = 'notify' | 'briefing' | 'ignore'`, `EventTarget = 'luis' | 'esposa' | 'grupo'`, `EventStatus = 'pending' | 'ignored' | 'queued' | 'notified' | 'briefed'`, `QueueEvent = { id: string; source: EventSource; kind: string; dedupeKey: string; summary: string; decision: EventDecision | null; reason: string | null; target: EventTarget | null; status: EventStatus; createdAt: string }`.
  - `insertEvent(e: { source: EventSource; kind: string; dedupeKey: string; summary: string; payload?: unknown }): Promise<QueueEvent | null>` — null se o dedupe_key já existia.
  - `listPendingEvents(): Promise<QueueEvent[]>`
  - `resolveEvent(id: string, r: { decision: EventDecision; reason: string; target: EventTarget; status: EventStatus }): Promise<void>` — grava `decided_at`.
  - `markNotified(id: string): Promise<void>` — status `notified` + `delivered_at`.
  - `listQueuedForTarget(target: EventTarget): Promise<QueueEvent[]>`
  - `markBriefed(ids: string[]): Promise<void>`
  - `countNotifiedSince(sinceIso: string, target: EventTarget): Promise<number>`
  - `getGroupChatId(): Promise<number | null>` (em `db/chats.ts`)

Nota: módulos `db/` neste repo não têm testes próprios (I/O puro; a lógica é testada nos consumidores com deps fakes) — mesmo padrão de `db/tasks.ts`.

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0003_fase4.sql`:

```sql
-- Fase 4: fila de eventos do motor de proatividade (auditável: decisão + motivo)
create table event_queue (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('finance','calendar','tasks')),
  kind text not null,
  dedupe_key text not null unique,
  summary text not null,
  payload jsonb,
  decision text check (decision in ('notify','briefing','ignore')),
  reason text,
  target text check (target in ('luis','esposa','grupo')),
  status text not null default 'pending'
    check (status in ('pending','ignored','queued','notified','briefed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  delivered_at timestamptz
);
create index event_queue_status_idx on event_queue (status, created_at);
create index event_queue_delivered_idx on event_queue (delivered_at) where delivered_at is not null;

alter table event_queue enable row level security;
```

(A migração NÃO é aplicada pelo implementer — o controlador aplica em produção via Management API no pós-merge.)

- [ ] **Step 2: Implementar `db/events.ts`**

```ts
import { supabase } from './client.js';

export type EventSource = 'finance' | 'calendar' | 'tasks';
export type EventDecision = 'notify' | 'briefing' | 'ignore';
export type EventTarget = 'luis' | 'esposa' | 'grupo';
export type EventStatus = 'pending' | 'ignored' | 'queued' | 'notified' | 'briefed';

export type QueueEvent = {
  id: string;
  source: EventSource;
  kind: string;
  dedupeKey: string;
  summary: string;
  decision: EventDecision | null;
  reason: string | null;
  target: EventTarget | null;
  status: EventStatus;
  createdAt: string;
};

const COLS = 'id, source, kind, dedupe_key, summary, decision, reason, target, status, created_at';

function toEvent(r: Record<string, unknown>): QueueEvent {
  return {
    id: r.id as string,
    source: r.source as EventSource,
    kind: r.kind as string,
    dedupeKey: r.dedupe_key as string,
    summary: r.summary as string,
    decision: (r.decision as EventDecision | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    target: (r.target as EventTarget | null) ?? null,
    status: r.status as EventStatus,
    createdAt: r.created_at as string,
  };
}

/** Insere um evento; retorna null se o dedupe_key já existia (evento repetido). */
export async function insertEvent(e: {
  source: EventSource;
  kind: string;
  dedupeKey: string;
  summary: string;
  payload?: unknown;
}): Promise<QueueEvent | null> {
  const { data, error } = await supabase
    .from('event_queue')
    .upsert(
      { source: e.source, kind: e.kind, dedupe_key: e.dedupeKey, summary: e.summary, payload: e.payload ?? null },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select(COLS);
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? toEvent(row) : null;
}

export async function listPendingEvents(): Promise<QueueEvent[]> {
  const { data, error } = await supabase
    .from('event_queue')
    .select(COLS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

/** Grava a decisão do julgamento (auditável) e o status resultante. */
export async function resolveEvent(
  id: string,
  r: { decision: EventDecision; reason: string; target: EventTarget; status: EventStatus },
): Promise<void> {
  const { error } = await supabase
    .from('event_queue')
    .update({ decision: r.decision, reason: r.reason, target: r.target, status: r.status, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markNotified(id: string): Promise<void> {
  const { error } = await supabase
    .from('event_queue')
    .update({ status: 'notified', delivered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function listQueuedForTarget(target: EventTarget): Promise<QueueEvent[]> {
  const { data, error } = await supabase
    .from('event_queue')
    .select(COLS)
    .eq('status', 'queued')
    .eq('target', target)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

export async function markBriefed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('event_queue')
    .update({ status: 'briefed', delivered_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}

/** Quantas notificações já foram entregues para um destino desde um instante (teto diário). */
export async function countNotifiedSince(sinceIso: string, target: EventTarget): Promise<number> {
  const { count, error } = await supabase
    .from('event_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'notified')
    .eq('target', target)
    .gte('delivered_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 3: Adicionar `getGroupChatId` em `apps/server/src/db/chats.ts`** (ao final do arquivo)

```ts
/** chat_id do grupo do casal (primeiro chat kind='group'); null se não cadastrado. */
export async function getGroupChatId(): Promise<number | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .eq('kind', 'group')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.id) : null;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_fase4.sql apps/server/src/db/events.ts apps/server/src/db/chats.ts
git commit -m "feat(f4): event_queue (migração 0003) + camada de dados de eventos"
```

---

### Task 2: Regras de silêncio e configuração de proatividade (`proactive/rules.ts`)

**Files:**
- Create: `apps/server/src/proactive/rules.ts`
- Create: `apps/server/src/proactive/rules.test.ts`

**Interfaces:**
- Consumes: `getState` de `../db/state.js`.
- Produces (usadas pelas Tasks 8 e 10):
  - `type ProactivityConfig = { quietStart: string; quietEnd: string; maxNotificationsPerDay: number }`
  - `DEFAULT_PROACTIVITY: ProactivityConfig` (= `{ quietStart: '22:00', quietEnd: '07:00', maxNotificationsPerDay: 5 }`)
  - `localTimeHHMM(now: Date, tz: string): string` (ex.: `'22:31'`)
  - `isQuietHours(hhmm: string, cfg: ProactivityConfig): boolean` — janela pode cruzar a meia-noite
  - `getProactivityConfig(): Promise<ProactivityConfig>` — `app_state['proactivity_config']` mesclado com defaults

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/rules.test.ts` (o `test-setup` vem primeiro: `rules.ts` importa `db/state.js`, que carrega o client do Supabase no load):

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROACTIVITY, isQuietHours, localTimeHHMM } from './rules.js';

describe('localTimeHHMM', () => {
  it('converte para HH:MM no fuso pedido', () => {
    // 01:30Z = 22:30 do dia anterior em São Paulo (UTC-3)
    expect(localTimeHHMM(new Date('2026-07-15T01:30:00Z'), 'America/Sao_Paulo')).toBe('22:30');
    expect(localTimeHHMM(new Date('2026-07-15T12:05:00Z'), 'America/Sao_Paulo')).toBe('09:05');
  });
});

describe('isQuietHours (22:00–07:00, cruza a meia-noite)', () => {
  it.each([
    ['22:00', true],
    ['23:59', true],
    ['00:30', true],
    ['06:59', true],
    ['07:00', false],
    ['12:00', false],
    ['21:59', false],
  ])('%s → %s', (hhmm, expected) => {
    expect(isQuietHours(hhmm, DEFAULT_PROACTIVITY)).toBe(expected);
  });

  it('janela que não cruza a meia-noite (13:00–15:00)', () => {
    const cfg = { ...DEFAULT_PROACTIVITY, quietStart: '13:00', quietEnd: '15:00' };
    expect(isQuietHours('14:00', cfg)).toBe(true);
    expect(isQuietHours('16:00', cfg)).toBe(false);
    expect(isQuietHours('12:59', cfg)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/rules.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/proactive/rules.ts`:

```ts
import { getState } from '../db/state.js';

export type ProactivityConfig = {
  quietStart: string; // 'HH:MM' — início do silêncio
  quietEnd: string; // 'HH:MM' — fim do silêncio
  maxNotificationsPerDay: number; // teto por destino (luis/esposa/grupo)
};

export const DEFAULT_PROACTIVITY: ProactivityConfig = {
  quietStart: '22:00',
  quietEnd: '07:00',
  maxNotificationsPerDay: 5,
};

/** Hora local 'HH:MM' de um instante num fuso. */
export function localTimeHHMM(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** true se hhmm cai na janela de silêncio [quietStart, quietEnd) — que pode cruzar a meia-noite. */
export function isQuietHours(hhmm: string, cfg: ProactivityConfig): boolean {
  const { quietStart: s, quietEnd: e } = cfg;
  if (s <= e) return hhmm >= s && hhmm < e;
  return hhmm >= s || hhmm < e; // cruza a meia-noite (ex.: 22:00–07:00)
}

/** Config de proatividade do app_state, mesclada com os defaults (edição via web fica p/ Fase 8). */
export async function getProactivityConfig(): Promise<ProactivityConfig> {
  const stored = await getState<Partial<ProactivityConfig>>('proactivity_config');
  return { ...DEFAULT_PROACTIVITY, ...(stored ?? {}) };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/proactive/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/proactive
git commit -m "feat(f4): regras de silêncio e config de proatividade"
```

---

### Task 3: Julgamento por IA (`proactive/judge.ts`) + purpose `judgment`

**Files:**
- Modify: `apps/server/src/agent/models.ts` (linha do `export type Purpose`)
- Modify: `apps/server/src/agent/models.test.ts` (1 teste novo)
- Create: `apps/server/src/proactive/judge.ts`
- Create: `apps/server/src/proactive/judge.test.ts`

**Interfaces:**
- Consumes: `generateAgentObject` de `../agent/models.js`; `recallMemories` de `../memory/recall.js`; `type QueueEvent` de `../db/events.js`.
- Produces (usada pela Task 8):
  - `type JudgedDecision = { id: string; decision: 'notify' | 'briefing' | 'ignore'; target: 'luis' | 'esposa' | 'grupo'; reason: string }`
  - `type JudgeDeps = { generate: <T>(opts: { purpose: 'judgment'; system: string; prompt: string; schema: import('zod').Schema<T> }) => Promise<T>; recall: (text: string, subjects: ('luis' | 'esposa' | 'casal')[]) => Promise<Array<{ content: string }>> }`
  - `judgeEvents(events: QueueEvent[], nowLocal: string, deps?: JudgeDeps): Promise<JudgedDecision[]>` — SEMPRE retorna uma decisão para cada evento de entrada (evento que a IA não devolveu vira `briefing`/`luis` por segurança).

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/agent/models.test.ts`, adicionar junto aos testes de `pickModelId` (siga o padrão de nome de variável do arquivo):

```ts
  it('judgment usa o modelo default mesmo com orçamento ok', () => {
    expect(pickModelId('judgment', 'ok', cfg)).toBe(cfg.MODEL_DEFAULT_ID);
  });
```

`apps/server/src/proactive/judge.test.ts` (o `test-setup` vem primeiro: `judge.ts` importa `db/events.js`, que carrega o client do Supabase no load):

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { QueueEvent } from '../db/events.js';
import { judgeEvents, type JudgeDeps } from './judge.js';

const ev = (id: string, summary: string): QueueEvent => ({
  id,
  source: 'finance',
  kind: 'atypical_expense',
  dedupeKey: `k-${id}`,
  summary,
  decision: null,
  reason: null,
  target: null,
  status: 'pending',
  createdAt: '2026-07-14T12:00:00Z',
});

function deps(over: Partial<JudgeDeps> = {}): JudgeDeps {
  return {
    recall: async () => [],
    generate: async () => ({ decisions: [] }) as never,
    ...over,
  };
}

describe('judgeEvents', () => {
  it('sem eventos, não chama a IA', async () => {
    let called = false;
    const d = deps({
      generate: async () => {
        called = true;
        return { decisions: [] } as never;
      },
    });
    expect(await judgeEvents([], '12:00', d)).toEqual([]);
    expect(called).toBe(false);
  });

  it('mapeia as decisões da IA e inclui memórias e hora no prompt', async () => {
    let seenPrompt = '';
    const d = deps({
      recall: async () => [{ content: 'Luis odeia ser interrompido com coisas triviais' }],
      generate: async (opts) => {
        seenPrompt = opts.prompt;
        return { decisions: [{ id: 'e1', decision: 'notify', target: 'luis', reason: 'gasto alto e incomum' }] } as never;
      },
    });
    const out = await judgeEvents([ev('e1', 'Gasto atípico: MERCADO LIVRE — R$ 950,00')], '14:30', d);
    expect(out).toEqual([{ id: 'e1', decision: 'notify', target: 'luis', reason: 'gasto alto e incomum' }]);
    expect(seenPrompt).toContain('R$ 950,00');
    expect(seenPrompt).toContain('14:30');
    expect(seenPrompt).toContain('coisas triviais');
  });

  it('evento que a IA não devolveu (ou com id desconhecido) vira briefing/luis por segurança', async () => {
    const d = deps({
      generate: async () =>
        ({ decisions: [{ id: 'zz-desconhecido', decision: 'ignore', target: 'luis', reason: 'x' }] }) as never,
    });
    const out = await judgeEvents([ev('e1', 'algo')], '10:00', d);
    expect(out).toEqual([
      { id: 'e1', decision: 'briefing', target: 'luis', reason: 'sem decisão da IA — guardado para o briefing' },
    ]);
  });

  it('falha da IA degrada tudo para briefing (nunca perde evento nem notifica sem julgamento)', async () => {
    const d = deps({
      generate: async () => {
        throw new Error('boom');
      },
    });
    const out = await judgeEvents([ev('e1', 'algo')], '10:00', d);
    expect(out[0].decision).toBe('briefing');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/proactive/judge.test.ts`
Expected: FAIL — purpose inexistente; módulo judge não existe.

- [ ] **Step 3: Implementar**

Em `apps/server/src/agent/models.ts`:

```ts
export type Purpose = 'chat' | 'reflection' | 'briefing' | 'analysis' | 'embedding' | 'categorize' | 'judgment';
```

(`STRONG_PURPOSES` não muda.)

`apps/server/src/proactive/judge.ts`:

```ts
import { z } from 'zod';
import { generateAgentObject } from '../agent/models.js';
import type { QueueEvent } from '../db/events.js';
import { recallMemories } from '../memory/recall.js';

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      decision: z.enum(['notify', 'briefing', 'ignore']),
      target: z.enum(['luis', 'esposa', 'grupo']),
      reason: z.string(),
    }),
  ),
});
type DecisionBatch = z.infer<typeof decisionSchema>;

export type JudgedDecision = DecisionBatch['decisions'][number];

export type JudgeDeps = {
  generate: <T>(opts: { purpose: 'judgment'; system: string; prompt: string; schema: z.Schema<T> }) => Promise<T>;
  recall: (text: string, subjects: ('luis' | 'esposa' | 'casal')[]) => Promise<Array<{ content: string }>>;
};

const defaultDeps: JudgeDeps = {
  generate: (opts) => generateAgentObject(opts),
  recall: recallMemories,
};

const SYSTEM = `Você é o filtro de proatividade de um assistente pessoal de um casal (Luis e esposa).
Para cada evento, decida:
- "notify": interromper AGORA — só para o que é urgente E acionável hoje (gasto muito fora do padrão, conflito de agenda iminente, compromisso de amanhã cedo avisado na véspera).
- "briefing": informativo — vale mencionar no resumo matinal, não vale interrupção.
- "ignore": trivial, repetido ou irrelevante.
Na dúvida, escolha "briefing". Escolha o destino: "luis", "esposa" (dono do assunto) ou "grupo" (assuntos do casal).
O motivo (reason) deve ser uma frase curta em PT-BR.`;

/** Julga eventos pendentes em UM lote com o modelo barato + memórias relevantes.
 *  Garante uma decisão para cada evento: ids não devolvidos pela IA (ou erro na IA)
 *  degradam para briefing — nunca se perde evento nem se notifica sem julgamento. */
export async function judgeEvents(
  events: QueueEvent[],
  nowLocal: string,
  deps: JudgeDeps = defaultDeps,
): Promise<JudgedDecision[]> {
  if (events.length === 0) return [];

  let memories: Array<{ content: string }> = [];
  try {
    memories = await deps.recall(events.map((e) => e.summary).join('\n'), ['luis', 'esposa', 'casal']);
  } catch (err) {
    console.error('[judge] recall falhou (seguindo sem memórias):', err);
  }

  const memoryBlock =
    memories.length > 0 ? `\nO que você sabe sobre eles:\n${memories.map((m) => `- ${m.content}`).join('\n')}\n` : '';

  const prompt = `Agora são ${nowLocal} (hora local).
${memoryBlock}
Eventos para julgar:
${events.map((e) => `- id ${e.id} [${e.source}/${e.kind}]: ${e.summary}`).join('\n')}

Devolva uma decisão para CADA id listado.`;

  let byId = new Map<string, JudgedDecision>();
  try {
    const result = await deps.generate({ purpose: 'judgment', system: SYSTEM, prompt, schema: decisionSchema });
    byId = new Map(result.decisions.map((d) => [d.id, d]));
  } catch (err) {
    console.error('[judge] julgamento falhou (degradando tudo para briefing):', err);
  }

  return events.map(
    (e) =>
      byId.get(e.id) ?? {
        id: e.id,
        decision: 'briefing' as const,
        target: 'luis' as const,
        reason: 'sem decisão da IA — guardado para o briefing',
      },
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/agent/models.test.ts apps/server/src/proactive/judge.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/agent/models.ts apps/server/src/agent/models.test.ts apps/server/src/proactive
git commit -m "feat(f4): julgamento de eventos em lote (purpose judgment, modelo default, memórias no contexto)"
```

---

### Task 4: Extrair o resumo do mês para `services/month-summary.ts` (reuso no briefing)

**Files:**
- Create: `apps/server/src/services/month-summary.ts`
- Create: `apps/server/src/services/month-summary.test.ts`
- Modify: `apps/server/src/tools/finance.ts` (tool `finance_month_summary` passa a delegar; remove a lógica inline e o helper `lastDayOfMonth` local)

**Interfaces:**
- Consumes: `type Category`, `type Transaction`, `listCategories`, `listTransactionsBetween` de `../db/finance.js`; `rootCategoryOf` de `../lib/category-tree.js`.
- Produces (usadas pela tool e pela Task 9):
  - `type MonthSummary = { month: string; income: number; expense: number; invested: number; balance: number; pending_review: number; by_category: Array<{ category: string; spent: number; target: number | null }> }`
  - `aggregateMonth(month: string, txs: Array<Transaction & { category_name: string | null }>, cats: Category[]): MonthSummary` — PURA, mesma lógica hoje inline na tool (pending antes do counts; counts=false fora de tudo; investment separado; sem categoria = despesa "Sem categoria"; by_category desc por spent com target da raiz)
  - `lastDayOfMonth(month: string): string`
  - `computeMonthSummary(month: string, deps?: { listCategories: typeof listCategories; listTransactionsBetween: typeof listTransactionsBetween }): Promise<MonthSummary>`

**Regra de compatibilidade:** o JSON devolvido pela tool `finance_month_summary` NÃO muda (mesmas chaves `month, income, expense, invested, balance, pending_review, by_category`) — os testes existentes de `tools/finance.test.ts` têm que continuar passando sem alteração.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/services/month-summary.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../db/finance.js';
import { aggregateMonth, lastDayOfMonth } from './month-summary.js';

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

describe('lastDayOfMonth', () => {
  it('fevereiro e meses de 31', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2026-07')).toBe('2026-07-31');
  });
});

describe('aggregateMonth', () => {
  it('replica a agregação da tool (raiz, counts, investimento, sem categoria)', () => {
    const out = aggregateMonth('2026-07', [
      tx({ id: 'a', amount: 200, category_id: 's1' }),
      tx({ id: 'b', amount: 300, category_id: 'r1' }),
      tx({ id: 'c', amount: 5000, kind: 'income', category_id: 'r2' }),
      tx({ id: 'd', amount: 1000, category_id: 'r3' }),
      tx({ id: 'e', amount: 999, category_id: 'r4' }),
      tx({ id: 'f', amount: 50, category_id: null, status: 'pending_review' }),
    ], cats);
    expect(out.month).toBe('2026-07');
    expect(out.income).toBe(5000);
    expect(out.expense).toBe(550);
    expect(out.invested).toBe(1000);
    expect(out.balance).toBe(5000 - 550 - 1000);
    expect(out.pending_review).toBe(1);
    expect(out.by_category[0]).toEqual({ category: 'Casa', spent: 500, target: 1000 });
    expect(out.by_category.find((c) => c.category === 'Sem categoria')).toEqual({ category: 'Sem categoria', spent: 50, target: null });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/services/month-summary.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/services/month-summary.ts` (a lógica é MOVIDA de `tools/finance.ts` — copie fielmente o comportamento):

```ts
import {
  listCategories,
  listTransactionsBetween,
  type Category,
  type Transaction,
} from '../db/finance.js';
import { rootCategoryOf } from '../lib/category-tree.js';

export type MonthSummary = {
  month: string;
  income: number;
  expense: number;
  invested: number;
  balance: number;
  pending_review: number;
  by_category: Array<{ category: string; spent: number; target: number | null }>;
};

/** Último dia do mês YYYY-MM em YYYY-MM-DD. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Agregação pura do mês — mesma regra da tool finance_month_summary:
 *  pendências contadas antes da exclusão por counts; counts=false fora de todos
 *  os totais; raiz investment vira "invested"; sem categoria conta como despesa. */
export function aggregateMonth(
  month: string,
  txs: Array<Transaction & { category_name: string | null }>,
  cats: Category[],
): MonthSummary {
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
  return {
    month,
    income,
    expense,
    invested,
    balance: income - expense - invested,
    pending_review: pendingReview,
    by_category: byCategory,
  };
}

export type MonthSummaryDeps = {
  listCategories: typeof listCategories;
  listTransactionsBetween: typeof listTransactionsBetween;
};

const defaultDeps: MonthSummaryDeps = { listCategories, listTransactionsBetween };

export async function computeMonthSummary(month: string, deps: MonthSummaryDeps = defaultDeps): Promise<MonthSummary> {
  const [txs, cats] = await Promise.all([
    deps.listTransactionsBetween(`${month}-01`, lastDayOfMonth(month)),
    deps.listCategories(),
  ]);
  return aggregateMonth(month, txs, cats);
}
```

Em `apps/server/src/tools/finance.ts`:
- Remover o helper local `lastDayOfMonth` e o import de `rootCategoryOf` (se ficar sem uso).
- Adicionar `import { aggregateMonth, lastDayOfMonth } from '../services/month-summary.js';`
- O `execute` de `finance_month_summary` vira:

```ts
      execute: async ({ month }) => {
        try {
          const m = month ?? deps.todayIso().slice(0, 7);
          const [txs, cats] = await Promise.all([
            deps.listTransactionsBetween(`${m}-01`, lastDayOfMonth(m)),
            deps.listCategories(),
          ]);
          return JSON.stringify(aggregateMonth(m, txs, cats));
        } catch {
          return FAIL;
        }
      },
```

(Os campos e a ordenação do JSON não mudam — `tools/finance.test.ts` continua passando sem edição.)

- [ ] **Step 4: Rodar e ver passar (incluindo os testes antigos da tool)**

Run: `npx vitest run apps/server/src/services/month-summary.test.ts apps/server/src/tools/finance.test.ts`
Expected: PASS em ambos, sem editar `tools/finance.test.ts`.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/services apps/server/src/tools/finance.ts
git commit -m "refactor(f4): agregação do mês extraída para services/month-summary (reuso no briefing)"
```

---

### Task 5: Coletor de finanças (`proactive/collect-finance.ts`)

**Files:**
- Modify: `apps/server/src/db/finance.ts` (2 funções novas ao final)
- Create: `apps/server/src/proactive/collect-finance.ts`
- Create: `apps/server/src/proactive/collect-finance.test.ts`

**Interfaces:**
- Consumes: `insertEvent` da Task 1; `listCommitments`, `type Transaction` de `../db/finance.js`; `todayInTz`, `addDays` de `../lib/dates.js`; `formatBrl` de `../lib/format.js`; `getConfig`.
- Produces (usada pela Task 8):
  - Em `db/finance.ts`: `listRecentBankExpenses(sinceDate: string): Promise<Transaction[]>` (source='bank', kind='expense', occurred_on >= sinceDate); `categoryExpenseAvg(categoryId: string, sinceDate: string): Promise<{ avg: number; count: number }>` (média/contagem de despesas confirmadas+pendentes da categoria desde a data).
  - `isAtypicalExpense(amount: number, stats: { avg: number; count: number }): boolean` — PURA: `amount >= 800` OU (`stats.count >= 5` E `amount >= 3 * stats.avg` E `amount >= 100`).
  - `collectFinanceEvents(deps?: FinanceCollectorDeps): Promise<number>` — nº de eventos NOVOS inseridos.

**Eventos emitidos:**
- kind `atypical_expense`, dedupe `fin:atypical:<tx.id>`, summary `Gasto atípico: <descrição> — <R$ valor> em <dd/mm>` — para despesas bancárias de ontem/hoje que passem em `isAtypicalExpense` contra a média de 90 dias da MESMA categoria (`{avg: 0, count: 0}` quando sem categoria).
- kind `commitment_due`, dedupe `fin:commitment:<id>:<YYYY-MM-DD>`, summary `Compromisso de hoje: <descrição>[ — <R$ valor>] (todo dia <N>)` — compromissos ativos com `day_of_month` = dia de hoje.
- "Fatura fechando" (spec §4) fica FORA desta fase — precisa do endpoint de faturas do Banco MCP (backlog anotado no ledger).

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/collect-finance.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/finance.js';
import { collectFinanceEvents, isAtypicalExpense, type FinanceCollectorDeps } from './collect-finance.js';

describe('isAtypicalExpense', () => {
  it('grande valor absoluto é sempre atípico', () => {
    expect(isAtypicalExpense(800, { avg: 0, count: 0 })).toBe(true);
  });
  it('3x a média com amostra suficiente e piso de R$ 100', () => {
    expect(isAtypicalExpense(300, { avg: 90, count: 6 })).toBe(true);
    expect(isAtypicalExpense(250, { avg: 90, count: 6 })).toBe(false); // < 3x
    expect(isAtypicalExpense(90, { avg: 20, count: 6 })).toBe(false); // < piso 100
    expect(isAtypicalExpense(300, { avg: 90, count: 3 })).toBe(false); // amostra insuficiente
  });
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't1',
  occurred_on: '2026-07-14',
  description: 'X',
  amount: 100,
  kind: 'expense',
  source: 'bank',
  category_id: null,
  status: 'pending_review',
  review_code: null,
  ...over,
});

function deps(over: Partial<FinanceCollectorDeps> = {}): FinanceCollectorDeps {
  return {
    listRecentBankExpenses: async () => [],
    categoryExpenseAvg: async () => ({ avg: 0, count: 0 }),
    listCommitments: async () => [],
    insertEvent: async () => null,
    todayIso: () => '2026-07-14',
    ...over,
  };
}

describe('collectFinanceEvents', () => {
  it('emite gasto atípico com dedupe por transação e valor em R$', async () => {
    const inserted: Array<{ dedupeKey: string; summary: string; kind: string }> = [];
    const d = deps({
      listRecentBankExpenses: async () => [tx({ id: 'aaa', description: 'MERCADO LIVRE', amount: 950 })],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e1' } as never;
      },
    });
    const n = await collectFinanceEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].kind).toBe('atypical_expense');
    expect(inserted[0].dedupeKey).toBe('fin:atypical:aaa');
    expect(inserted[0].summary).toContain('R$ 950,00');
  });

  it('gasto normal não vira evento; dedupe repetido não conta', async () => {
    const d = deps({
      listRecentBankExpenses: async () => [tx({ id: 'aaa', amount: 30 }), tx({ id: 'bbb', amount: 900 })],
      insertEvent: async () => null, // já existia
    });
    expect(await collectFinanceEvents(d)).toBe(0);
  });

  it('compromisso do dia vira evento com dedupe por dia', async () => {
    const inserted: Array<{ dedupeKey: string; summary: string }> = [];
    const d = deps({
      listCommitments: async () => [
        { id: 'c1', description: 'Internet', amount: 120, day_of_month: 14, active: true },
        { id: 'c2', description: 'Aluguel', amount: null, day_of_month: 5, active: true },
      ],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e1' } as never;
      },
    });
    const n = await collectFinanceEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].dedupeKey).toBe('fin:commitment:c1:2026-07-14');
    expect(inserted[0].summary).toContain('Internet');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/collect-finance.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Ao final de `apps/server/src/db/finance.ts`:

```ts
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
```

`apps/server/src/proactive/collect-finance.ts`:

```ts
import {
  categoryExpenseAvg,
  listCommitments,
  listRecentBankExpenses,
} from '../db/finance.js';
import { insertEvent } from '../db/events.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';

const BIG_TICKET = 800; // acima disso é sempre atípico
const MULTIPLIER = 3; // vezes a média da categoria
const MIN_AMOUNT = 100; // piso para não alertar miudeza
const MIN_SAMPLES = 5; // amostras mínimas para a média valer
const STATS_WINDOW_DAYS = 90;

/** PURA: um gasto é atípico se for muito alto em absoluto, ou muito acima da média da categoria. */
export function isAtypicalExpense(amount: number, stats: { avg: number; count: number }): boolean {
  if (amount >= BIG_TICKET) return true;
  return stats.count >= MIN_SAMPLES && amount >= MULTIPLIER * stats.avg && amount >= MIN_AMOUNT;
}

export type FinanceCollectorDeps = {
  listRecentBankExpenses: typeof listRecentBankExpenses;
  categoryExpenseAvg: typeof categoryExpenseAvg;
  listCommitments: typeof listCommitments;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: FinanceCollectorDeps = {
  listRecentBankExpenses,
  categoryExpenseAvg,
  listCommitments,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

/** Coleta eventos financeiros: gasto atípico (ontem/hoje) e compromisso do dia.
 *  Retorna quantos eventos NOVOS entraram na fila (dedupe descarta repetidos). */
export async function collectFinanceEvents(deps: FinanceCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  let inserted = 0;

  // 1) gastos atípicos entre ontem e hoje
  const recent = await deps.listRecentBankExpenses(addDays(today, -1));
  const statsWindow = addDays(today, -STATS_WINDOW_DAYS);
  for (const t of recent) {
    const stats = t.category_id
      ? await deps.categoryExpenseAvg(t.category_id, statsWindow)
      : { avg: 0, count: 0 };
    if (!isAtypicalExpense(Number(t.amount), stats)) continue;
    const [, m, d] = t.occurred_on.split('-');
    const ev = await deps.insertEvent({
      source: 'finance',
      kind: 'atypical_expense',
      dedupeKey: `fin:atypical:${t.id}`,
      summary: `Gasto atípico: ${t.description} — ${formatBrl(Number(t.amount))} em ${d}/${m}`,
      payload: { txId: t.id, amount: t.amount },
    });
    if (ev) inserted++;
  }

  // 2) compromissos do dia
  const dayOfMonth = Number(today.slice(8, 10));
  for (const c of await deps.listCommitments()) {
    if (c.day_of_month !== dayOfMonth) continue;
    const ev = await deps.insertEvent({
      source: 'finance',
      kind: 'commitment_due',
      dedupeKey: `fin:commitment:${c.id}:${today}`,
      summary: `Compromisso de hoje: ${c.description}${c.amount ? ` — ${formatBrl(Number(c.amount))}` : ''} (todo dia ${c.day_of_month})`,
      payload: { commitmentId: c.id },
    });
    if (ev) inserted++;
  }

  return inserted;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/proactive/collect-finance.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/db/finance.ts apps/server/src/proactive
git commit -m "feat(f4): coletor de finanças (gasto atípico + compromisso do dia)"
```

---

### Task 6: Coletor de agenda (`proactive/collect-calendar.ts`)

**Files:**
- Create: `apps/server/src/proactive/collect-calendar.ts`
- Create: `apps/server/src/proactive/collect-calendar.test.ts`

**Interfaces:**
- Consumes: `insertEvent` (Task 1); `getUserBySubject` de `../db/chats.js`; `getState`/`setState` de `../db/state.js`; `type CalEvent`, `type CalendarApi`, `zonedDayStartIso`, `zonedDayEndIso` de `../tools/calendar.js`; `todayInTz`, `addDays`; `getConfig`.
- Produces (usada pela Task 8):
  - `type CalSnapshot = Record<string, { title: string; start: string; end: string }>`
  - `snapshotOf(events: CalEvent[]): CalSnapshot` — PURA
  - `diffSnapshots(prev: CalSnapshot, curr: CalSnapshot): { added: string[]; changed: string[] }` — PURA (added = ids novos; changed = ids com title/start/end diferentes)
  - `findConflicts(events: CalEvent[]): Array<[CalEvent, CalEvent]>` — PURA (pares com sobreposição de horário, ignora all-day)
  - `earlyEventsOn(events: CalEvent[], date: string): CalEvent[]` — PURA (eventos com hora naquele dia começando antes de 09:00 local — compara o prefixo `HH` do start)
  - `collectCalendarEvents(deps?: CalendarCollectorDeps): Promise<number>`

**Comportamento do coletor** (por pessoa: luis e esposa, cada uma com seu `calendarId`):
1. Lê os eventos de hoje até hoje+7 (`zonedDayStartIso(hoje)`..`zonedDayEndIso(hoje+7)`).
2. Compara com o snapshot salvo em `app_state` chave `calendar_snapshot_<subject>`:
   - PRIMEIRA execução (snapshot ausente): só salva o snapshot, não emite nada (evita avalanche).
   - `added` → kind `event_new`, dedupe `cal:new:<subject>:<eventId>`, summary `Evento novo na agenda de <Nome>: "<título>" <dd/mm HH:MM>` (para all-day, só `dd/mm`).
   - `changed` → kind `event_changed`, dedupe `cal:changed:<subject>:<eventId>:<start novo>`, summary `Evento alterado na agenda de <Nome>: "<título>" agora <dd/mm HH:MM>`.
3. `findConflicts` sobre os eventos atuais → kind `calendar_conflict`, dedupe `cal:conflict:<subject>:<idMenor>:<idMaior>` (ids ordenados), summary `Conflito na agenda de <Nome>: "<A>" e "<B>" se sobrepõem em <dd/mm>`.
4. `earlyEventsOn(eventos, amanhã)` → kind `early_tomorrow`, dedupe `cal:early:<subject>:<eventId>:<amanhã>`, summary `Amanhã cedo (<HH:MM>): "<título>" — agenda de <Nome>`.
5. Salva o snapshot novo. Usuário sem `calendarId` é pulado em silêncio. Erro num usuário não impede o outro (try/catch por usuário com `console.error`).

Formato de data nos summaries: derive `dd/mm` de `start.slice(0,10)` e `HH:MM` de `start.slice(11,16)` quando houver hora.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/collect-calendar.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { CalEvent } from '../tools/calendar.js';
import {
  collectCalendarEvents,
  diffSnapshots,
  earlyEventsOn,
  findConflicts,
  snapshotOf,
  type CalendarCollectorDeps,
} from './collect-calendar.js';

const ev = (id: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id,
  title: `Evento ${id}`,
  start: '2026-07-15T10:00:00-03:00',
  end: '2026-07-15T11:00:00-03:00',
  allDay: false,
  ...over,
});

describe('diffSnapshots', () => {
  it('detecta novos e alterados', () => {
    const prev = snapshotOf([ev('a'), ev('b')]);
    const curr = snapshotOf([ev('a'), ev('b', { start: '2026-07-15T14:00:00-03:00' }), ev('c')]);
    const d = diffSnapshots(prev, curr);
    expect(d.added).toEqual(['c']);
    expect(d.changed).toEqual(['b']);
  });
});

describe('findConflicts', () => {
  it('pares sobrepostos com hora; ignora all-day e não sobrepostos', () => {
    const a = ev('a', { start: '2026-07-15T10:00:00-03:00', end: '2026-07-15T11:00:00-03:00' });
    const b = ev('b', { start: '2026-07-15T10:30:00-03:00', end: '2026-07-15T12:00:00-03:00' });
    const c = ev('c', { start: '2026-07-15T13:00:00-03:00', end: '2026-07-15T14:00:00-03:00' });
    const d = ev('d', { allDay: true, start: '2026-07-15', end: '2026-07-16' });
    const conflicts = findConflicts([a, b, c, d]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});

describe('earlyEventsOn', () => {
  it('só eventos com hora do dia pedido antes das 09:00', () => {
    const cedo = ev('a', { start: '2026-07-16T07:30:00-03:00' });
    const tarde = ev('b', { start: '2026-07-16T10:00:00-03:00' });
    const outroDia = ev('c', { start: '2026-07-17T07:00:00-03:00' });
    const allDay = ev('d', { allDay: true, start: '2026-07-16', end: '2026-07-17' });
    expect(earlyEventsOn([cedo, tarde, outroDia, allDay], '2026-07-16').map((e) => e.id)).toEqual(['a']);
  });
});

describe('collectCalendarEvents', () => {
  const luis = { id: 'u1', name: 'Luis', calendarId: 'cal-luis', telegramChatId: 1 } as never;

  function deps(over: Partial<CalendarCollectorDeps> = {}): CalendarCollectorDeps {
    const state = new Map<string, unknown>();
    return {
      getUserBySubject: async (s) => (s === 'luis' ? luis : null),
      listEvents: async () => [],
      getState: async (k) => (state.get(k) as never) ?? null,
      setState: async (k, v) => void state.set(k, v),
      insertEvent: async () => ({ id: 'e' }) as never,
      todayIso: () => '2026-07-15',
      timezone: 'America/Sao_Paulo',
      ...over,
    };
  }

  it('primeira execução só salva snapshot, sem eventos', async () => {
    let saved: unknown = null;
    const d = deps({
      listEvents: async () => [ev('a')],
      setState: async (_k, v) => void (saved = v),
    });
    expect(await collectCalendarEvents(d)).toBe(0);
    expect(saved).toEqual(snapshotOf([ev('a')]));
  });

  it('segunda execução emite evento novo com dedupe correto', async () => {
    const state = new Map<string, unknown>([['calendar_snapshot_luis', snapshotOf([ev('a')])]]);
    const inserted: Array<{ dedupeKey: string; kind: string; summary: string }> = [];
    const d = deps({
      listEvents: async () => [ev('a'), ev('c', { title: 'Dentista' })],
      getState: async (k) => (state.get(k) as never) ?? null,
      setState: async (k, v) => void state.set(k, v),
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e' } as never;
      },
    });
    const n = await collectCalendarEvents(d);
    expect(n).toBe(1);
    expect(inserted[0].kind).toBe('event_new');
    expect(inserted[0].dedupeKey).toBe('cal:new:luis:c');
    expect(inserted[0].summary).toContain('Dentista');
    expect(inserted[0].summary).toContain('Luis');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/collect-calendar.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/proactive/collect-calendar.ts`:

```ts
import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { getState, setState } from '../db/state.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { zonedDayEndIso, zonedDayStartIso, type CalEvent } from '../tools/calendar.js';

export type CalSnapshot = Record<string, { title: string; start: string; end: string }>;

export function snapshotOf(events: CalEvent[]): CalSnapshot {
  const out: CalSnapshot = {};
  for (const e of events) out[e.id] = { title: e.title, start: e.start, end: e.end };
  return out;
}

export function diffSnapshots(prev: CalSnapshot, curr: CalSnapshot): { added: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, e] of Object.entries(curr)) {
    const old = prev[id];
    if (!old) added.push(id);
    else if (old.title !== e.title || old.start !== e.start || old.end !== e.end) changed.push(id);
  }
  return { added, changed };
}

/** Pares de eventos com hora que se sobrepõem (all-day fora). */
export function findConflicts(events: CalEvent[]): Array<[CalEvent, CalEvent]> {
  const timed = events.filter((e) => !e.allDay);
  const out: Array<[CalEvent, CalEvent]> = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)) out.push([a, b]);
    }
  }
  return out;
}

/** Eventos com hora do dia `date` começando antes das 09:00 locais. */
export function earlyEventsOn(events: CalEvent[], date: string): CalEvent[] {
  return events.filter((e) => !e.allDay && e.start.slice(0, 10) === date && e.start.slice(11, 13) < '09');
}

function ddmm(start: string): string {
  const [, m, d] = start.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function whenLabel(e: CalEvent): string {
  return e.allDay ? ddmm(e.start) : `${ddmm(e.start)} ${e.start.slice(11, 16)}`;
}

export type CalendarCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listEvents: (calendarId: string, timeMinIso: string, timeMaxIso: string) => Promise<CalEvent[]>;
  getState: typeof getState;
  setState: typeof setState;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
  timezone: string;
};

/** Coleta eventos de agenda dos dois: novos/alterados (diff de snapshot), conflitos
 *  e compromissos de amanhã cedo. Primeira execução por pessoa só grava o snapshot. */
export async function collectCalendarEvents(deps: CalendarCollectorDeps): Promise<number> {
  const today = deps.todayIso();
  const tomorrow = addDays(today, 1);
  let inserted = 0;

  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user?.calendarId) continue;

      const events = await deps.listEvents(
        user.calendarId,
        zonedDayStartIso(today, deps.timezone),
        zonedDayEndIso(addDays(today, 7), deps.timezone),
      );
      const stateKey = `calendar_snapshot_${subject}`;
      const prev = await deps.getState<CalSnapshot>(stateKey);
      const curr = snapshotOf(events);

      if (prev === null) {
        await deps.setState(stateKey, curr); // primeira vez: só baseline
        continue;
      }

      const byId = new Map(events.map((e) => [e.id, e]));
      const { added, changed } = diffSnapshots(prev, curr);

      for (const id of added) {
        const e = byId.get(id)!;
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'event_new',
          dedupeKey: `cal:new:${subject}:${id}`,
          summary: `Evento novo na agenda de ${user.name}: "${e.title}" ${whenLabel(e)}`,
        });
        if (r) inserted++;
      }
      for (const id of changed) {
        const e = byId.get(id)!;
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'event_changed',
          dedupeKey: `cal:changed:${subject}:${id}:${e.start}`,
          summary: `Evento alterado na agenda de ${user.name}: "${e.title}" agora ${whenLabel(e)}`,
        });
        if (r) inserted++;
      }
      for (const [a, b] of findConflicts(events)) {
        const [lo, hi] = [a.id, b.id].sort();
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'calendar_conflict',
          dedupeKey: `cal:conflict:${subject}:${lo}:${hi}`,
          summary: `Conflito na agenda de ${user.name}: "${a.title}" e "${b.title}" se sobrepõem em ${ddmm(a.start)}`,
        });
        if (r) inserted++;
      }
      for (const e of earlyEventsOn(events, tomorrow)) {
        const r = await deps.insertEvent({
          source: 'calendar',
          kind: 'early_tomorrow',
          dedupeKey: `cal:early:${subject}:${e.id}:${tomorrow}`,
          summary: `Amanhã cedo (${e.start.slice(11, 16)}): "${e.title}" — agenda de ${user.name}`,
        });
        if (r) inserted++;
      }

      await deps.setState(stateKey, curr);
    } catch (err) {
      console.error(`[collect-calendar] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}

/** Deps default de produção (calendar client é injetado pelo engine — ver Task 8). */
export function defaultCalendarCollectorDeps(listEvents: CalendarCollectorDeps['listEvents']): CalendarCollectorDeps {
  const cfg = getConfig();
  return {
    getUserBySubject,
    listEvents,
    getState,
    setState,
    insertEvent,
    todayIso: () => todayInTz(cfg.TIMEZONE),
    timezone: cfg.TIMEZONE,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/proactive/collect-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/proactive
git commit -m "feat(f4): coletor de agenda (novos/alterados via snapshot, conflitos, amanhã cedo)"
```

---

### Task 7: Coletor de tarefas (`proactive/collect-tasks.ts`)

**Files:**
- Modify: `apps/server/src/db/tasks.ts` (1 função nova)
- Create: `apps/server/src/proactive/collect-tasks.ts`
- Create: `apps/server/src/proactive/collect-tasks.test.ts`

**Interfaces:**
- Consumes: `insertEvent` (Task 1); `getUserBySubject` de `../db/chats.js`; `todayInTz` de `../lib/dates.js`; `getConfig`.
- Produces (usada pela Task 8):
  - Em `db/tasks.ts`: `type TaskWithAge = Task & { createdAt: string }`; `listOpenTasksWithAge(userId: string): Promise<TaskWithAge[]>`.
  - `selectTaskEvents(tasks: TaskWithAge[], today: string): Array<{ kind: 'task_overdue' | 'task_stale'; task: TaskWithAge; dedupeKey: string }>` — PURA:
    - `task_overdue`: `dueDate !== null && dueDate < today` → dedupe `task:overdue:<id>:<dueDate>` (uma vez por prazo).
    - `task_stale`: sem `dueDate`, aberta há >= 7 dias → dedupe `task:stale:<id>:w<floor(diasAberta/7)>` (re-emite a cada semana cheia).
  - `collectTaskEvents(deps?: TaskCollectorDeps): Promise<number>` — roda para luis e esposa; summary `Tarefa atrasada de <Nome>: "<título>" (prazo <dd/mm>)` / `Tarefa parada há <N> dias: "<título>" (<Nome>)`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/collect-tasks.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { TaskWithAge } from '../db/tasks.js';
import { collectTaskEvents, selectTaskEvents, type TaskCollectorDeps } from './collect-tasks.js';

const task = (over: Partial<TaskWithAge>): TaskWithAge => ({
  id: 't1',
  title: 'Tarefa',
  status: 'open',
  dueDate: null,
  createdAt: '2026-07-01T12:00:00Z',
  ...over,
});

describe('selectTaskEvents', () => {
  it('atrasada: prazo no passado, dedupe por prazo', () => {
    const out = selectTaskEvents([task({ id: 'a', dueDate: '2026-07-10' })], '2026-07-14');
    expect(out).toEqual([
      { kind: 'task_overdue', task: expect.objectContaining({ id: 'a' }), dedupeKey: 'task:overdue:a:2026-07-10' },
    ]);
  });
  it('prazo hoje ou futuro não é atrasada', () => {
    expect(selectTaskEvents([task({ dueDate: '2026-07-14' })], '2026-07-14')).toEqual([]);
    expect(selectTaskEvents([task({ dueDate: '2026-07-20' })], '2026-07-14')).toEqual([]);
  });
  it('parada: sem prazo, >= 7 dias aberta, bucket semanal no dedupe', () => {
    const out = selectTaskEvents([task({ id: 'b', createdAt: '2026-07-01T12:00:00Z' })], '2026-07-14');
    expect(out).toEqual([
      { kind: 'task_stale', task: expect.objectContaining({ id: 'b' }), dedupeKey: 'task:stale:b:w1' },
    ]);
    // com 15 dias, bucket muda para w2 (re-emite semanalmente)
    expect(selectTaskEvents([task({ id: 'b', createdAt: '2026-07-01T12:00:00Z' })], '2026-07-16')[0].dedupeKey).toBe(
      'task:stale:b:w2',
    );
  });
  it('aberta há menos de 7 dias sem prazo não emite', () => {
    expect(selectTaskEvents([task({ createdAt: '2026-07-10T12:00:00Z' })], '2026-07-14')).toEqual([]);
  });
});

describe('collectTaskEvents', () => {
  it('emite para os dois usuários com nome no summary', async () => {
    const inserted: Array<{ summary: string; dedupeKey: string }> = [];
    const deps: TaskCollectorDeps = {
      getUserBySubject: async (s) =>
        s === 'luis'
          ? ({ id: 'u1', name: 'Luis', calendarId: null, telegramChatId: 1 } as never)
          : ({ id: 'u2', name: 'Esposa', calendarId: null, telegramChatId: 2 } as never),
      listOpenTasksWithAge: async (userId) =>
        userId === 'u1' ? [task({ id: 'a', dueDate: '2026-07-10', title: 'Pagar boleto' })] : [],
      insertEvent: async (e) => {
        inserted.push(e);
        return { id: 'e' } as never;
      },
      todayIso: () => '2026-07-14',
    };
    const n = await collectTaskEvents(deps);
    expect(n).toBe(1);
    expect(inserted[0].summary).toContain('Luis');
    expect(inserted[0].summary).toContain('Pagar boleto');
    expect(inserted[0].summary).toContain('10/07');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/collect-tasks.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Ao final de `apps/server/src/db/tasks.ts`:

```ts
export type TaskWithAge = Task & { createdAt: string };

/** Tarefas abertas com created_at (para detectar tarefa parada). */
export async function listOpenTasksWithAge(userId: string): Promise<TaskWithAge[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, created_at')
    .eq('user_id', userId)
    .eq('status', 'open');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...toTask(r), createdAt: r.created_at as string }));
}
```

`apps/server/src/proactive/collect-tasks.ts`:

```ts
import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { listOpenTasksWithAge, type TaskWithAge } from '../db/tasks.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

const STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** PURA: seleciona tarefas atrasadas (uma vez por prazo) e paradas (re-emite por semana cheia). */
export function selectTaskEvents(
  tasks: TaskWithAge[],
  today: string,
): Array<{ kind: 'task_overdue' | 'task_stale'; task: TaskWithAge; dedupeKey: string }> {
  const out: Array<{ kind: 'task_overdue' | 'task_stale'; task: TaskWithAge; dedupeKey: string }> = [];
  for (const t of tasks) {
    if (t.dueDate) {
      if (t.dueDate < today) out.push({ kind: 'task_overdue', task: t, dedupeKey: `task:overdue:${t.id}:${t.dueDate}` });
      continue;
    }
    const daysOpen = Math.floor((new Date(`${today}T12:00:00Z`).getTime() - new Date(t.createdAt).getTime()) / MS_PER_DAY);
    if (daysOpen >= STALE_DAYS) {
      out.push({ kind: 'task_stale', task: t, dedupeKey: `task:stale:${t.id}:w${Math.floor(daysOpen / STALE_DAYS)}` });
    }
  }
  return out;
}

export type TaskCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listOpenTasksWithAge: typeof listOpenTasksWithAge;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: TaskCollectorDeps = {
  getUserBySubject,
  listOpenTasksWithAge,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

function ddmm(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export async function collectTaskEvents(deps: TaskCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  let inserted = 0;
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      const tasks = await deps.listOpenTasksWithAge(user.id);
      for (const sel of selectTaskEvents(tasks, today)) {
        const summary =
          sel.kind === 'task_overdue'
            ? `Tarefa atrasada de ${user.name}: "${sel.task.title}" (prazo ${ddmm(sel.task.dueDate!)})`
            : `Tarefa parada há mais de ${STALE_DAYS} dias: "${sel.task.title}" (${user.name})`;
        const r = await deps.insertEvent({ source: 'tasks', kind: sel.kind, dedupeKey: sel.dedupeKey, summary });
        if (r) inserted++;
      }
    } catch (err) {
      console.error(`[collect-tasks] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/proactive/collect-tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/db/tasks.ts apps/server/src/proactive
git commit -m "feat(f4): coletor de tarefas (atrasadas e paradas, dedupe semanal)"
```

---

### Task 8: Entrega com regras de silêncio + ciclo do motor (`proactive/engine.ts`)

**Files:**
- Create: `apps/server/src/proactive/engine.ts`
- Create: `apps/server/src/proactive/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, 5–7 (`listPendingEvents`, `resolveEvent`, `markNotified`, `countNotifiedSince`, `judgeEvents`, `getProactivityConfig`, `isQuietHours`, `localTimeHHMM`, coletores); `getSubjectChatId`, `getGroupChatId` de `../db/chats.js`; `zonedDayStartIso` de `../tools/calendar.js`; `hasGoogleCreds`, `getCalendarClient` de `../lib/google.js`; `calendarApiFromGoogle` de `../tools/calendar.js`; `isBankConfigured` de `../lib/banco-mcp.js`; `todayInTz`; `getConfig`; `type Bot` de grammy.
- Produces (usada pelas Tasks 9-wiring/10):
  - `type EngineDeps` (tudo injetável; default de produção monta os coletores reais)
  - `runProactiveCycle(sources: Array<'finance' | 'calendar' | 'tasks'>, send: (chatId: number, text: string) => Promise<void>, deps?: EngineDeps): Promise<{ collected: number; judged: number; notified: number }>`
  - `defaultEngineDeps(): EngineDeps` — usa os coletores reais; calendário só entra se `hasGoogleCreds` (senão o source 'calendar' vira no-op), finanças só se `isBankConfigured`.

**Regras de entrega (o coração das "regras de respeito"):**
1. Coleta (só os sources pedidos), depois julga TODOS os pendentes (mesmo de ciclos anteriores) em um lote com a hora local.
2. Para cada decisão: `ignore` → `resolveEvent(status 'ignored')`; `briefing` → `resolveEvent(status 'queued')`.
3. `notify`: se `isQuietHours(agora)` → `resolveEvent(status 'queued')` com reason acrescida de ` [horário de silêncio]`; senão conta `countNotifiedSince(início do dia local, target)`; se `>= maxNotificationsPerDay` → `resolveEvent(status 'queued')` com reason acrescida de ` [teto diário atingido]`; senão `resolveEvent(status 'queued')` NÃO — grava decisão com status `queued` e então envia `🔔 <summary>` para o chat do target (`getSubjectChatId('luis'|'esposa')` ou `getGroupChatId()`), e chama `markNotified(id)`. Se o envio falhar, o evento fica `queued` (vai para o briefing; nunca se perde).
4. Destino sem chat cadastrado (null) → `queued`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/engine.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { QueueEvent } from '../db/events.js';
import { runProactiveCycle, type EngineDeps } from './engine.js';

const ev = (id: string): QueueEvent => ({
  id,
  source: 'finance',
  kind: 'atypical_expense',
  dedupeKey: `k${id}`,
  summary: `Evento ${id}`,
  decision: null,
  reason: null,
  target: null,
  status: 'pending',
  createdAt: '2026-07-14T12:00:00Z',
});

type Resolved = { id: string; status: string; reason: string };

function deps(over: Partial<EngineDeps> = {}): EngineDeps & { resolved: Resolved[]; notified: string[] } {
  const resolved: Resolved[] = [];
  const notified: string[] = [];
  const d = {
    resolved,
    notified,
    collectors: {},
    listPendingEvents: async () => [],
    judgeEvents: async (events: QueueEvent[]) =>
      events.map((e) => ({ id: e.id, decision: 'notify' as const, target: 'luis' as const, reason: 'urgente' })),
    resolveEvent: async (id: string, r: { status: string; reason: string }) => void resolved.push({ id, status: r.status, reason: r.reason }),
    markNotified: async (id: string) => void notified.push(id),
    countNotifiedSince: async () => 0,
    getSubjectChatId: async () => 111,
    getGroupChatId: async () => 999,
    config: async () => ({ quietStart: '22:00', quietEnd: '07:00', maxNotificationsPerDay: 5 }),
    nowLocalHHMM: () => '14:00',
    dayStartIso: () => '2026-07-14T00:00:00-03:00',
    ...over,
  };
  return d as never;
}

describe('runProactiveCycle', () => {
  it('notify fora do silêncio: envia, marca notified', async () => {
    const sent: Array<[number, string]> = [];
    const d = deps({ listPendingEvents: async () => [ev('e1')] });
    const out = await runProactiveCycle([], async (chatId, text) => void sent.push([chatId, text]), d);
    expect(sent).toEqual([[111, '🔔 Evento e1']]);
    expect(d.notified).toEqual(['e1']);
    expect(out.notified).toBe(1);
  });

  it('horário de silêncio rebaixa para queued com motivo', async () => {
    const sent: unknown[] = [];
    const d = deps({ listPendingEvents: async () => [ev('e1')], nowLocalHHMM: () => '23:00' });
    await runProactiveCycle([], async (...a) => void sent.push(a), d);
    expect(sent).toEqual([]);
    expect(d.resolved[0].status).toBe('queued');
    expect(d.resolved[0].reason).toContain('silêncio');
  });

  it('teto diário rebaixa para queued', async () => {
    const d = deps({ listPendingEvents: async () => [ev('e1')], countNotifiedSince: async () => 5 });
    await runProactiveCycle([], async () => {}, d);
    expect(d.resolved[0].status).toBe('queued');
    expect(d.resolved[0].reason).toContain('teto');
  });

  it('briefing e ignore só resolvem status', async () => {
    const d = deps({
      listPendingEvents: async () => [ev('e1'), ev('e2')],
      judgeEvents: async () => [
        { id: 'e1', decision: 'briefing', target: 'esposa', reason: 'informativo' },
        { id: 'e2', decision: 'ignore', target: 'luis', reason: 'trivial' },
      ],
    });
    await runProactiveCycle([], async () => {}, d);
    expect(d.resolved).toEqual([
      { id: 'e1', status: 'queued', reason: 'informativo' },
      { id: 'e2', status: 'ignored', reason: 'trivial' },
    ]);
  });

  it('falha no envio deixa o evento queued (não perde)', async () => {
    const d = deps({ listPendingEvents: async () => [ev('e1')] });
    await runProactiveCycle(
      [],
      async () => {
        throw new Error('telegram fora');
      },
      d,
    );
    expect(d.notified).toEqual([]);
    expect(d.resolved[0].status).toBe('queued');
  });

  it('roda só os coletores pedidos', async () => {
    const ran: string[] = [];
    const d = deps({
      collectors: {
        finance: async () => {
          ran.push('finance');
          return 2;
        },
        tasks: async () => {
          ran.push('tasks');
          return 1;
        },
      },
    });
    const out = await runProactiveCycle(['finance'], async () => {}, d);
    expect(ran).toEqual(['finance']);
    expect(out.collected).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/engine.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/proactive/engine.ts`:

```ts
import {
  countNotifiedSince,
  listPendingEvents,
  markNotified,
  resolveEvent,
  type EventTarget,
  type QueueEvent,
} from '../db/events.js';
import { getGroupChatId, getSubjectChatId } from '../db/chats.js';
import { isBankConfigured } from '../lib/banco-mcp.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';
import { calendarApiFromGoogle, zonedDayStartIso } from '../tools/calendar.js';
import { collectFinanceEvents } from './collect-finance.js';
import { collectCalendarEvents, defaultCalendarCollectorDeps } from './collect-calendar.js';
import { collectTaskEvents } from './collect-tasks.js';
import { judgeEvents, type JudgedDecision } from './judge.js';
import { getProactivityConfig, isQuietHours, localTimeHHMM, type ProactivityConfig } from './rules.js';

export type CollectorSource = 'finance' | 'calendar' | 'tasks';

export type EngineDeps = {
  collectors: Partial<Record<CollectorSource, () => Promise<number>>>;
  listPendingEvents: typeof listPendingEvents;
  judgeEvents: (events: QueueEvent[], nowLocal: string) => Promise<JudgedDecision[]>;
  resolveEvent: typeof resolveEvent;
  markNotified: typeof markNotified;
  countNotifiedSince: typeof countNotifiedSince;
  getSubjectChatId: typeof getSubjectChatId;
  getGroupChatId: typeof getGroupChatId;
  config: () => Promise<ProactivityConfig>;
  nowLocalHHMM: () => string;
  dayStartIso: () => string;
};

/** Deps de produção: coletores reais, respeitando o que está configurado. */
export function defaultEngineDeps(): EngineDeps {
  const cfg = getConfig();
  const collectors: EngineDeps['collectors'] = {
    tasks: () => collectTaskEvents(),
  };
  if (isBankConfigured()) collectors.finance = () => collectFinanceEvents();
  if (hasGoogleCreds(cfg)) {
    const api = calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE);
    collectors.calendar = () => collectCalendarEvents(defaultCalendarCollectorDeps(api.listEvents.bind(api)));
  }
  return {
    collectors,
    listPendingEvents,
    judgeEvents,
    resolveEvent,
    markNotified,
    countNotifiedSince,
    getSubjectChatId,
    getGroupChatId,
    config: getProactivityConfig,
    nowLocalHHMM: () => localTimeHHMM(new Date(), cfg.TIMEZONE),
    dayStartIso: () => zonedDayStartIso(todayInTz(cfg.TIMEZONE), cfg.TIMEZONE),
  };
}

async function chatIdFor(target: EventTarget, deps: EngineDeps): Promise<number | null> {
  if (target === 'grupo') return deps.getGroupChatId();
  return deps.getSubjectChatId(target);
}

/** Um ciclo do motor: coleta (sources pedidos) → julga TODOS os pendentes → entrega
 *  os notify respeitando silêncio e teto diário (rebaixados viram queued → briefing). */
export async function runProactiveCycle(
  sources: CollectorSource[],
  send: (chatId: number, text: string) => Promise<void>,
  deps: EngineDeps = defaultEngineDeps(),
): Promise<{ collected: number; judged: number; notified: number }> {
  let collected = 0;
  for (const s of sources) {
    const run = deps.collectors[s];
    if (!run) continue; // source não configurado (sem Google/banco) — no-op
    try {
      collected += await run();
    } catch (err) {
      console.error(`[engine] coletor ${s} falhou:`, err);
    }
  }

  const pending = await deps.listPendingEvents();
  if (pending.length === 0) return { collected, judged: 0, notified: 0 };

  const decisions = await deps.judgeEvents(pending, deps.nowLocalHHMM());
  const cfg = await deps.config();
  const byId = new Map(pending.map((e) => [e.id, e]));
  let notified = 0;

  for (const d of decisions) {
    const event = byId.get(d.id);
    if (!event) continue;

    if (d.decision === 'ignore') {
      await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'ignored' });
      continue;
    }
    if (d.decision === 'briefing') {
      await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'queued' });
      continue;
    }

    // notify — regras de respeito
    if (isQuietHours(deps.nowLocalHHMM(), cfg)) {
      await deps.resolveEvent(d.id, {
        decision: d.decision,
        reason: `${d.reason} [horário de silêncio]`,
        target: d.target,
        status: 'queued',
      });
      continue;
    }
    const sentToday = await deps.countNotifiedSince(deps.dayStartIso(), d.target);
    if (sentToday >= cfg.maxNotificationsPerDay) {
      await deps.resolveEvent(d.id, {
        decision: d.decision,
        reason: `${d.reason} [teto diário atingido]`,
        target: d.target,
        status: 'queued',
      });
      continue;
    }
    const chatId = await chatIdFor(d.target, deps);
    // grava a decisão antes de enviar; se o envio falhar, fica queued (briefing pega)
    await deps.resolveEvent(d.id, { decision: d.decision, reason: d.reason, target: d.target, status: 'queued' });
    if (chatId === null) continue;
    try {
      await send(chatId, `🔔 ${event.summary}`);
      await deps.markNotified(d.id);
      notified++;
    } catch (err) {
      console.error('[engine] envio falhou (evento fica para o briefing):', err);
    }
  }

  return { collected, judged: decisions.length, notified };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/proactive/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/proactive
git commit -m "feat(f4): motor de proatividade (ciclo coleta→julgamento→entrega com silêncio e teto)"
```

---

### Task 9: Briefing matinal unificado (`jobs/briefing.ts`)

**Files:**
- Create: `apps/server/src/jobs/briefing.ts`
- Create: `apps/server/src/jobs/briefing.test.ts`

**Interfaces:**
- Consumes: `getUserBySubject`, `getSubjectChatId`, `getGroupChatId` de `../db/chats.js`; `listTasks`, `type Task` de `../db/tasks.js`; `listCommitments`, `type Commitment` de `../db/finance.js`; `listQueuedForTarget`, `markBriefed`, `type QueueEvent` de `../db/events.js`; `computeMonthSummary`, `type MonthSummary` de `../services/month-summary.js`; `generateAgentText` de `../agent/models.js`; `zonedDayStartIso`, `zonedDayEndIso`, `calendarApiFromGoogle`, `type CalEvent` de `../tools/calendar.js`; `hasGoogleCreds`, `getCalendarClient`; `todayInTz`; `formatBrl`; `getConfig`.
- Produces (usada pela Task 10):
  - `type BriefingContext = { name: string; date: string; agenda: CalEvent[]; tasks: Task[]; queued: string[]; commitmentsToday: Commitment[]; finance: MonthSummary | null }`
  - `buildBriefingPrompt(ctx: BriefingContext): string` — PURA
  - `isEmptyBriefing(ctx: BriefingContext): boolean` — PURA: true quando agenda, tasks, queued, commitmentsToday vazios E finance é null
  - `runDailyBriefing(send: (chatId: number, text: string) => Promise<void>, deps?: BriefingDeps): Promise<void>`
  - `runCoupleBriefing(send: (chatId: number, text: string) => Promise<void>, deps?: BriefingDeps): Promise<void>` (sábados, no grupo)

**Regras:**
- Por pessoa (luis, esposa): agenda de HOJE (se calendário configurado), tarefas abertas com prazo até hoje (`dueDate !== null && dueDate <= hoje`), eventos `queued` do seu target, compromissos de hoje; `finance` = resumo do mês SÓ para o Luis. Esposa com briefing vazio (`isEmptyBriefing`) → pula em silêncio; Luis recebe sempre (finance nunca é null para ele).
- Texto gerado com `generateAgentText` purpose `'briefing'` (modelo forte), sem tools; instrução: análise CURTA e OPINADA (não lista), PT-BR, datas dd/mm, valores R$; abre com "Bom dia".
- Depois de enviar, `markBriefed` nos ids dos eventos queued usados. Eventos com target `grupo` são consumidos pelo briefing do casal (sábado); nos outros dias continuam queued.
- Casal (sábado): agenda do fim de semana (sáb+dom) dos dois + resumo do mês + eventos queued do target `grupo`; envia no grupo; markBriefed nos ids do grupo. Falha por pessoa não derruba as demais (try/catch com console.error).

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/jobs/briefing.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { buildBriefingPrompt, isEmptyBriefing, runDailyBriefing, type BriefingContext, type BriefingDeps } from './briefing.js';

const baseCtx: BriefingContext = {
  name: 'Luis',
  date: '2026-07-15',
  agenda: [{ id: 'e1', title: 'Dentista', start: '2026-07-15T10:00:00-03:00', end: '2026-07-15T11:00:00-03:00', allDay: false }],
  tasks: [{ id: 't1', title: 'Pagar boleto', status: 'open', dueDate: '2026-07-15' }],
  queued: ['Gasto atípico: X — R$ 950,00 em 14/07'],
  commitmentsToday: [{ id: 'c1', description: 'Internet', amount: 120, day_of_month: 15, active: true }],
  finance: { month: '2026-07', income: 5000, expense: 2000, invested: 0, balance: 3000, pending_review: 3, by_category: [{ category: 'Casa', spent: 800, target: 1000 }] },
};

describe('buildBriefingPrompt', () => {
  it('inclui agenda, tarefas, eventos guardados, compromissos e finanças', () => {
    const p = buildBriefingPrompt(baseCtx);
    expect(p).toContain('Dentista');
    expect(p).toContain('10:00');
    expect(p).toContain('Pagar boleto');
    expect(p).toContain('R$ 950,00');
    expect(p).toContain('Internet');
    expect(p).toContain('R$ 2000,00'); // despesa do mês via formatBrl
    expect(p).toContain('Casa');
  });
  it('sem finanças, não inclui bloco financeiro', () => {
    const p = buildBriefingPrompt({ ...baseCtx, finance: null });
    expect(p).not.toContain('Situação do mês');
  });
});

describe('isEmptyBriefing', () => {
  it('vazio quando não há nada a dizer', () => {
    expect(
      isEmptyBriefing({ name: 'Esposa', date: '2026-07-15', agenda: [], tasks: [], queued: [], commitmentsToday: [], finance: null }),
    ).toBe(true);
    expect(isEmptyBriefing(baseCtx)).toBe(false);
  });
});

describe('runDailyBriefing', () => {
  function deps(over: Partial<BriefingDeps> = {}): BriefingDeps & { briefed: string[][] } {
    const briefed: string[][] = [];
    return {
      briefed,
      getUserBySubject: async (s) =>
        ({ id: s === 'luis' ? 'u1' : 'u2', name: s === 'luis' ? 'Luis' : 'Esposa', calendarId: null, telegramChatId: 0 }) as never,
      getSubjectChatId: async (s) => (s === 'luis' ? 111 : 222),
      getGroupChatId: async () => 999,
      listAgenda: async () => [],
      listTasks: async () => [],
      listCommitments: async () => [],
      listQueuedForTarget: async () => [],
      markBriefed: async (ids: string[]) => void briefed.push(ids),
      monthSummary: async () => baseCtx.finance!,
      generate: async () => 'Bom dia! Resumo do dia…',
      todayIso: () => '2026-07-15',
      ...over,
    } as never;
  }

  it('Luis sempre recebe; esposa vazia é pulada; eventos usados viram briefed', async () => {
    const sent: Array<[number, string]> = [];
    const d = deps({
      listQueuedForTarget: async (t) =>
        t === 'luis'
          ? ([{ id: 'q1', summary: 'Gasto atípico', status: 'queued' }] as never)
          : ([] as never),
    });
    await runDailyBriefing(async (chatId, text) => void sent.push([chatId, text]), d);
    expect(sent).toEqual([[111, 'Bom dia! Resumo do dia…']]);
    expect(d.briefed).toEqual([['q1']]);
  });

  it('falha na geração de um não impede o outro', async () => {
    const sent: number[] = [];
    let call = 0;
    const d = deps({
      listQueuedForTarget: async () => [{ id: 'q1', summary: 'x', status: 'queued' }] as never, // ambos têm conteúdo
      monthSummary: async () => baseCtx.finance!,
      generate: async () => {
        call++;
        if (call === 1) throw new Error('boom');
        return 'Bom dia!';
      },
    });
    await runDailyBriefing(async (chatId) => void sent.push(chatId), d);
    expect(sent).toEqual([222]); // luis falhou, esposa recebeu
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/jobs/briefing.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/jobs/briefing.ts`:

```ts
import { generateAgentText } from '../agent/models.js';
import { getGroupChatId, getSubjectChatId, getUserBySubject } from '../db/chats.js';
import { listQueuedForTarget, markBriefed, type QueueEvent } from '../db/events.js';
import { listCommitments, type Commitment } from '../db/finance.js';
import { listTasks, type Task } from '../db/tasks.js';
import { getConfig } from '../lib/config.js';
import { addDays, todayInTz } from '../lib/dates.js';
import { formatBrl } from '../lib/format.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';
import { computeMonthSummary, type MonthSummary } from '../services/month-summary.js';
import {
  calendarApiFromGoogle,
  zonedDayEndIso,
  zonedDayStartIso,
  type CalEvent,
} from '../tools/calendar.js';

export type BriefingContext = {
  name: string;
  date: string;
  agenda: CalEvent[];
  tasks: Task[];
  queued: string[];
  commitmentsToday: Commitment[];
  finance: MonthSummary | null;
};

function ddmm(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function eventLine(e: CalEvent): string {
  return e.allDay ? `- ${e.title} (dia inteiro)` : `- ${e.title} às ${e.start.slice(11, 16)}`;
}

/** PURA: contexto → prompt com os dados do dia (o modelo escreve a análise). */
export function buildBriefingPrompt(ctx: BriefingContext): string {
  const parts: string[] = [`Data: ${ddmm(ctx.date)}. Pessoa: ${ctx.name}.`];
  if (ctx.agenda.length > 0) parts.push(`Agenda de hoje:\n${ctx.agenda.map(eventLine).join('\n')}`);
  if (ctx.tasks.length > 0)
    parts.push(`Tarefas com prazo até hoje:\n${ctx.tasks.map((t) => `- ${t.title}${t.dueDate ? ` (${ddmm(t.dueDate)})` : ''}`).join('\n')}`);
  if (ctx.commitmentsToday.length > 0)
    parts.push(
      `Compromissos financeiros de hoje:\n${ctx.commitmentsToday.map((c) => `- ${c.description}${c.amount ? ` — ${formatBrl(Number(c.amount))}` : ''}`).join('\n')}`,
    );
  if (ctx.queued.length > 0) parts.push(`Acontecimentos guardados desde ontem:\n${ctx.queued.map((q) => `- ${q}`).join('\n')}`);
  if (ctx.finance) {
    const f = ctx.finance;
    const cats = f.by_category
      .slice(0, 5)
      .map((c) => `- ${c.category}: ${formatBrl(c.spent)}${c.target != null ? ` de ${formatBrl(c.target)}` : ''}`)
      .join('\n');
    parts.push(
      `Situação do mês (${f.month}): receitas ${formatBrl(f.income)}, despesas ${formatBrl(f.expense)}, investido ${formatBrl(f.invested)}, saldo ${formatBrl(f.balance)}, ${f.pending_review} gastos a classificar.${cats ? `\nPor categoria:\n${cats}` : ''}`,
    );
  }
  return parts.join('\n\n');
}

/** PURA: nada a dizer → não manda briefing (silêncio > ruído). */
export function isEmptyBriefing(ctx: BriefingContext): boolean {
  return (
    ctx.agenda.length === 0 &&
    ctx.tasks.length === 0 &&
    ctx.queued.length === 0 &&
    ctx.commitmentsToday.length === 0 &&
    ctx.finance === null
  );
}

const SYSTEM = `Você escreve o briefing matinal de um assistente pessoal.
Análise CURTA e OPINADA em PT-BR — não uma lista burocrática: conecte os pontos, destaque o que importa e o que pode dar errado hoje, sugira no máximo uma ação.
Abra com "Bom dia". Datas como dd/mm, valores como R$ 123,45. Sem ids. Máximo ~10 linhas.`;

export type BriefingDeps = {
  getUserBySubject: typeof getUserBySubject;
  getSubjectChatId: typeof getSubjectChatId;
  getGroupChatId: typeof getGroupChatId;
  listAgenda: (calendarId: string, fromDate: string, toDate: string) => Promise<CalEvent[]>;
  listTasks: typeof listTasks;
  listCommitments: typeof listCommitments;
  listQueuedForTarget: typeof listQueuedForTarget;
  markBriefed: typeof markBriefed;
  monthSummary: (month: string) => Promise<MonthSummary>;
  generate: (system: string, prompt: string) => Promise<string>;
  todayIso: () => string;
};

export function defaultBriefingDeps(): BriefingDeps {
  const cfg = getConfig();
  const listAgenda: BriefingDeps['listAgenda'] = hasGoogleCreds(cfg)
    ? (calendarId, fromDate, toDate) =>
        calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE).listEvents(
          calendarId,
          zonedDayStartIso(fromDate, cfg.TIMEZONE),
          zonedDayEndIso(toDate, cfg.TIMEZONE),
        )
    : async () => [];
  return {
    getUserBySubject,
    getSubjectChatId,
    getGroupChatId,
    listAgenda,
    listTasks,
    listCommitments,
    listQueuedForTarget,
    markBriefed,
    monthSummary: computeMonthSummary,
    generate: (system, prompt) =>
      generateAgentText({ purpose: 'briefing', system, messages: [{ role: 'user', content: prompt }] }),
    todayIso: () => todayInTz(cfg.TIMEZONE),
  };
}

async function contextFor(subject: 'luis' | 'esposa', deps: BriefingDeps): Promise<{ ctx: BriefingContext; queuedIds: string[] } | null> {
  const user = await deps.getUserBySubject(subject);
  if (!user) return null;
  const today = deps.todayIso();
  const dayOfMonth = Number(today.slice(8, 10));

  const agenda = user.calendarId ? await deps.listAgenda(user.calendarId, today, today).catch(() => []) : [];
  const tasks = (await deps.listTasks(user.id, 'open')).filter((t) => t.dueDate !== null && t.dueDate <= today);
  const queuedEvents: QueueEvent[] = await deps.listQueuedForTarget(subject);
  const commitmentsToday =
    subject === 'luis' ? (await deps.listCommitments()).filter((c) => c.day_of_month === dayOfMonth) : [];
  const finance = subject === 'luis' ? await deps.monthSummary(today.slice(0, 7)) : null;

  return {
    ctx: { name: user.name, date: today, agenda, tasks, queued: queuedEvents.map((q) => q.summary), commitmentsToday, finance },
    queuedIds: queuedEvents.map((q) => q.id),
  };
}

/** Briefing individual das 07:00 — cada pessoa no seu privado; vazio não é enviado. */
export async function runDailyBriefing(
  send: (chatId: number, text: string) => Promise<void>,
  deps: BriefingDeps = defaultBriefingDeps(),
): Promise<void> {
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const r = await contextFor(subject, deps);
      if (!r || isEmptyBriefing(r.ctx)) continue;
      const chatId = await deps.getSubjectChatId(subject);
      if (chatId === null) continue;
      const text = await deps.generate(SYSTEM, buildBriefingPrompt(r.ctx));
      await send(chatId, text);
      await deps.markBriefed(r.queuedIds);
    } catch (err) {
      console.error(`[briefing] falhou para ${subject}:`, err);
    }
  }
}

/** Visão do casal — sábados no grupo: fim de semana dos dois + mês + eventos do grupo. */
export async function runCoupleBriefing(
  send: (chatId: number, text: string) => Promise<void>,
  deps: BriefingDeps = defaultBriefingDeps(),
): Promise<void> {
  try {
    const chatId = await deps.getGroupChatId();
    if (chatId === null) return;
    const today = deps.todayIso();
    const sunday = addDays(today, 1);

    const agenda: CalEvent[] = [];
    for (const subject of ['luis', 'esposa'] as const) {
      const user = await deps.getUserBySubject(subject);
      if (!user?.calendarId) continue;
      const events = await deps.listAgenda(user.calendarId, today, sunday).catch(() => [] as CalEvent[]);
      agenda.push(...events.map((e) => ({ ...e, title: `${e.title} (${user.name})` })));
    }
    const queuedEvents = await deps.listQueuedForTarget('grupo');
    const finance = await deps.monthSummary(today.slice(0, 7));

    const ctx: BriefingContext = {
      name: 'Casal',
      date: today,
      agenda,
      tasks: [],
      queued: queuedEvents.map((q) => q.summary),
      commitmentsToday: [],
      finance,
    };
    const prompt = `${buildBriefingPrompt(ctx)}\n\n(É a visão de SÁBADO do casal: foque no fim de semana e em como o mês está indo.)`;
    const text = await deps.generate(SYSTEM, prompt);
    await send(chatId, text);
    await deps.markBriefed(queuedEvents.map((q) => q.id));
  } catch (err) {
    console.error('[briefing] visão do casal falhou:', err);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/jobs/briefing.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/jobs
git commit -m "feat(f4): briefing matinal unificado (modelo forte) + visão do casal aos sábados"
```

---

### Task 10: Agendamento, scripts e documentação

**Files:**
- Modify: `apps/server/src/jobs/scheduler.ts` (novos crons)
- Create: `apps/server/src/scripts/run-briefing.ts`
- Create: `apps/server/src/scripts/run-proactive.ts`
- Modify: `apps/server/package.json` (scripts `job:briefing` e `job:proactive`)
- Modify: `SETUP.md` (seção "Fase 4")

**Interfaces:**
- Consumes: `runProactiveCycle`, `defaultEngineDeps` (Task 8); `runDailyBriefing`, `runCoupleBriefing` (Task 9); `hasGoogleCreds`, `isBankConfigured`; scheduler atual (reflexão 03:00, revisão financeira 08:00 — INTOCADOS).
- Produces: crons novos rodando; execução manual via npm scripts.

- [ ] **Step 1: Novo `apps/server/src/jobs/scheduler.ts`**

```ts
import cron from 'node-cron';
import type { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { hasGoogleCreds } from '../lib/google.js';
import { isBankConfigured } from '../lib/banco-mcp.js';
import { runReflection } from '../memory/reflection.js';
import { runFinanceReview } from './finance-review.js';
import { runDailyBriefing, runCoupleBriefing } from './briefing.js';
import { runProactiveCycle, type CollectorSource } from '../proactive/engine.js';

export function startScheduler(bot: Bot): void {
  const cfg = getConfig();
  const opts = { timezone: cfg.TIMEZONE };
  const send = (chatId: number, text: string) => bot.api.sendMessage(chatId, text).then(() => undefined);
  const cycle = (sources: CollectorSource[], label: string) => () => {
    runProactiveCycle(sources, send).catch((err) => console.error(`[job:proactive:${label}]`, err));
  };

  cron.schedule('0 3 * * *', () => {
    runReflection().catch((err) => console.error('[job:reflection]', err));
  }, opts);

  cron.schedule('0 8 * * *', () => {
    runFinanceReview(bot).catch((err) => console.error('[job:finance-review]', err));
  }, opts);

  // Proatividade (spec §4): calendário 30min, banco 2h, tarefas 1x/dia antes do briefing
  if (hasGoogleCreds(cfg)) cron.schedule('*/30 * * * *', cycle(['calendar'], 'calendar'), opts);
  if (isBankConfigured()) cron.schedule('0 */2 * * *', cycle(['finance'], 'finance'), opts);
  cron.schedule('30 6 * * *', cycle(['tasks'], 'tasks'), opts);

  // Briefing matinal (modelo forte) + visão do casal aos sábados
  cron.schedule('0 7 * * *', () => {
    runDailyBriefing(send).catch((err) => console.error('[job:briefing]', err));
  }, opts);
  cron.schedule('0 8 * * 6', () => {
    runCoupleBriefing(send).catch((err) => console.error('[job:briefing-casal]', err));
  }, opts);

  console.log(
    `[scheduler] reflexão 03:00, revisão financeira 08:00, briefing 07:00 (+casal sáb 08:00), coletores: calendário ${hasGoogleCreds(cfg) ? '30min' : 'off'}, banco ${isBankConfigured() ? '2h' : 'off'}, tarefas 06:30 — ${cfg.TIMEZONE}`,
  );
}
```

- [ ] **Step 2: Scripts manuais**

`apps/server/src/scripts/run-briefing.ts`:

```ts
// Roda o briefing matinal manualmente (uso: npm run job:briefing -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runDailyBriefing } from '../jobs/briefing.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
await runDailyBriefing((chatId, text) => bot.api.sendMessage(chatId, text).then(() => undefined));
console.log('briefing executado');
```

`apps/server/src/scripts/run-proactive.ts`:

```ts
// Roda um ciclo completo de proatividade (uso: npm run job:proactive -w apps/server)
import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import { runProactiveCycle } from '../proactive/engine.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
const out = await runProactiveCycle(['finance', 'calendar', 'tasks'], (chatId, text) =>
  bot.api.sendMessage(chatId, text).then(() => undefined),
);
console.log(`ciclo: ${out.collected} coletados, ${out.judged} julgados, ${out.notified} notificados`);
```

Em `apps/server/package.json`, adicionar aos `scripts`:

```json
    "job:briefing": "tsx src/scripts/run-briefing.ts",
    "job:proactive": "tsx src/scripts/run-proactive.ts",
```

- [ ] **Step 3: SETUP.md** — adicionar seção ao final (antes de "Notas"):

```markdown
## 6. Fase 4 (proatividade + briefing)

1. **Migração**: executar `supabase/migrations/0003_fase4.sql` (SQL Editor ou Management API).
2. Nada novo no `.env` — os coletores usam as credenciais já existentes (Google/Banco MCP); sem elas, o coletor correspondente fica desligado.
3. Regras de respeito: silêncio 22:00–07:00 e máx. 5 notificações/dia por pessoa (defaults; ajustáveis na chave `proactivity_config` do `app_state` até a UI da Fase 8).
4. Testes manuais: `npm run job:proactive -w apps/server` (um ciclo de coleta+julgamento+entrega) e `npm run job:briefing -w apps/server` (briefing na hora).
```

- [ ] **Step 4: Rodar TODOS os testes e typecheck**

Run: `npx vitest run` (raiz)
Expected: PASS na suíte inteira (sem regressões).

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/jobs/scheduler.ts apps/server/src/scripts apps/server/package.json SETUP.md
git commit -m "feat(f4): crons da proatividade e do briefing + scripts manuais + setup"
```

---

## Pós-merge (operacional — controlador + Luis)

1. **Merge** na master local (finishing-a-development-branch, opção 1).
2. **Migração 0003** aplicada em produção pelo controlador (Management API).
3. **Luis:** `git push`; VPS puxa em até 30min (ou FORCE deploy). Nada novo no `.env`.
4. **UAT:**
   - `npm run job:proactive` → primeiro ciclo salva snapshot das agendas (sem eventos); criar um evento novo no Google Calendar e rodar de novo → julgamento decide (provável notificação 🔔 ou guarda p/ briefing); conferir `event_queue` (decision/reason preenchidos).
   - `npm run job:briefing` → briefing chega no privado do Luis (com finanças do mês); esposa só recebe se tiver conteúdo.
   - Amanhã 07:00/08:00: briefing + revisão financeira automáticos; sábado 08:00: visão do casal no grupo.
