# Fase 2 — Tarefas + Agenda + Compras: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O assistente gerencia tarefas por pessoa, eventos no Google Calendar (agenda do Luis + agenda compartilhada da esposa) e a lista de compras do casal, tudo por conversa natural — a esposa passa a usar de verdade.

**Architecture:** Novas tools plugadas no loop do agente existente. As tools passam a ser construídas **por identidade de chat** (`buildTools(identity)`) para escopo correto (privado dela = coisas dela; grupo = casal). Google Calendar via `googleapis` com o OAuth da v1 (client + refresh token reaproveitados do `.env`); calendário de cada pessoa resolvido por `users.calendar_id`. Se as credenciais Google faltarem, as tools de agenda não são registradas (bot segue normal).

**Tech Stack:** existente + `googleapis` (npm).

## Global Constraints

- Copy voltada ao usuário em PT-BR; identificadores em inglês.
- ESM NodeNext → imports relativos com `.js`.
- Testes nunca chamam LLM/Supabase/Google reais (deps injetadas; factories de tools recebem repos/clients fake).
- Datas em `America/Sao_Paulo` (via `cfg.TIMEZONE`); `due_date` como string `YYYY-MM-DD`; datetimes de eventos em ISO com timezone.
- Tools sempre retornam mensagens de erro amigáveis em PT-BR (nunca stack trace).
- Credenciais Google opcionais: schema com `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` como `z.string().optional()`; agenda ativa só com as 3 presentes.

---

### Task 1: Migração 0002 + repositórios (tasks, shopping, calendar_id)

**Files:**
- Create: `supabase/migrations/0002_fase2.sql`, `apps/server/src/db/tasks.ts`, `apps/server/src/db/shopping.ts`
- Modify: `apps/server/src/db/chats.ts` (adicionar `getUserBySubject`)

**Interfaces:**
- Produces:
  - `type Task = { id: string; title: string; status: 'open' | 'done'; dueDate: string | null }`
  - `listTasks(userId: string, status?: 'open' | 'done'): Promise<Task[]>` (ordem: due_date asc nulls last, created_at asc)
  - `addTask(userId: string, title: string, dueDate?: string): Promise<Task>`
  - `completeTask(taskId: string): Promise<void>`
  - `updateTask(taskId: string, patch: { title?: string; dueDate?: string | null }): Promise<void>`
  - `type ShoppingItem = { id: string; name: string }`
  - `listItems(): Promise<ShoppingItem[]>`; `addItems(names: string[], addedByUserId: string | null): Promise<void>`; `removeItem(itemId: string): Promise<void>`; `clearItems(): Promise<void>`
  - `type UserRecord = { id: string; name: string; calendarId: string | null }`; `getUserBySubject(subject: 'luis' | 'esposa'): Promise<UserRecord | null>`

(Wrappers finos de IO — sem testes unitários, padrão das fases anteriores; gate = typecheck. A migração NÃO é executada pelo implementador — o controller roda via Management API.)

- [ ] **Step 1: Migração `supabase/migrations/0002_fase2.sql`**

```sql
-- Fase 2: tarefas por pessoa, lista de compras do casal, agenda por usuário
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index tasks_user_status_idx on tasks (user_id, status);

create table shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  added_by uuid references users(id),
  created_at timestamptz not null default now()
);

alter table users add column calendar_id text;

alter table tasks enable row level security;
alter table shopping_items enable row level security;
```

- [ ] **Step 2: `db/tasks.ts`**

```ts
import { supabase } from './client.js';

export type Task = { id: string; title: string; status: 'open' | 'done'; dueDate: string | null };

function toTask(r: { id: string; title: string; status: string; due_date: string | null }): Task {
  return { id: r.id, title: r.title, status: r.status as Task['status'], dueDate: r.due_date };
}

export async function listTasks(userId: string, status?: 'open' | 'done'): Promise<Task[]> {
  let q = supabase
    .from('tasks')
    .select('id, title, status, due_date')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toTask);
}

export async function addTask(userId: string, title: string, dueDate?: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ user_id: userId, title, due_date: dueDate ?? null })
    .select('id, title, status, due_date')
    .single();
  if (error) throw error;
  return toTask(data);
}

export async function completeTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw error;
}

export async function updateTask(
  taskId: string,
  patch: { title?: string; dueDate?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  const { error } = await supabase.from('tasks').update(row).eq('id', taskId);
  if (error) throw error;
}
```

- [ ] **Step 3: `db/shopping.ts`**

```ts
import { supabase } from './client.js';

export type ShoppingItem = { id: string; name: string };

export async function listItems(): Promise<ShoppingItem[]> {
  const { data, error } = await supabase
    .from('shopping_items')
    .select('id, name')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShoppingItem[];
}

export async function addItems(names: string[], addedByUserId: string | null): Promise<void> {
  const rows = names.map((name) => ({ name, added_by: addedByUserId }));
  const { error } = await supabase.from('shopping_items').insert(rows);
  if (error) throw error;
}

export async function removeItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('shopping_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function clearItems(): Promise<void> {
  const { error } = await supabase.from('shopping_items').delete().gte('created_at', '1970-01-01');
  if (error) throw error;
}
```

- [ ] **Step 4: `getUserBySubject` em `db/chats.ts`** (append no arquivo)

```ts
export type UserRecord = { id: string; name: string; calendarId: string | null };

export async function getUserBySubject(subject: 'luis' | 'esposa'): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, calendar_id')
    .eq('subject', subject)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, calendarId: data.calendar_id ?? null };
}
```

- [ ] **Step 5: Typecheck e commit**

Run: `npm run typecheck && npm test`
Expected: limpo / 34 verdes.

```bash
git add -A && git commit -m "feat: migração fase 2 e repositórios de tarefas, compras e usuários"
```

---

### Task 2: Cliente Google Calendar + script de descoberta de agendas

**Files:**
- Create: `apps/server/src/lib/google.ts`, `apps/server/src/scripts/google-calendars.ts`
- Modify: `apps/server/src/lib/config.ts` (3 campos opcionais), `apps/server/src/lib/config.test.ts` (1 teste), `apps/server/package.json` (dep `googleapis` + script `google:calendars`), raiz `package.json` (script `google:calendars`), `.env.example`

**Interfaces:**
- Produces: `hasGoogleCreds(cfg: Config): boolean`; `getCalendarClient(cfg: Config): calendar_v3.Calendar` (lança se sem credenciais — chamar só após `hasGoogleCreds`).

- [ ] **Step 1: Teste do config (falhando)** — adicionar em `config.test.ts`:

```ts
  it('credenciais Google são opcionais', () => {
    const cfg = loadConfig(minimal as NodeJS.ProcessEnv);
    expect(cfg.GOOGLE_CLIENT_ID).toBeUndefined();
  });
```

- [ ] **Step 2: Config** — adicionar ao schema:

```ts
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
```

- [ ] **Step 3: `npm i -w apps/server googleapis` e `lib/google.ts`**

```ts
import { google, type calendar_v3 } from 'googleapis';
import type { Config } from './config.js';

export function hasGoogleCreds(cfg: Config): boolean {
  return Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET && cfg.GOOGLE_REFRESH_TOKEN);
}

export function getCalendarClient(cfg: Config): calendar_v3.Calendar {
  if (!hasGoogleCreds(cfg)) throw new Error('credenciais Google ausentes');
  const auth = new google.auth.OAuth2(cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: cfg.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}
```

- [ ] **Step 4: `scripts/google-calendars.ts`** (para descobrir o id da agenda da esposa)

```ts
import { getConfig } from '../lib/config.js';
import { getCalendarClient, hasGoogleCreds } from '../lib/google.js';

const cfg = getConfig();
if (!hasGoogleCreds(cfg)) {
  console.error('Defina GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN no .env');
  process.exit(1);
}
const cal = getCalendarClient(cfg);
const { data } = await cal.calendarList.list();
for (const c of data.items ?? []) {
  console.log(`${c.summary}  →  ${c.id}${c.primary ? '  (primary)' : ''}`);
}
```

Scripts: `"google:calendars": "tsx src/scripts/google-calendars.ts"` (server) e `"google:calendars": "npm run google:calendars -w apps/server"` (raiz). `.env.example`: adicionar as 3 chaves Google vazias.

- [ ] **Step 5: Gates e commit**

Run: `npm test && npm run typecheck`
```bash
git add -A && git commit -m "feat: cliente Google Calendar e script de descoberta de agendas"
```

---

### Task 3: Tools de tarefas e compras (factories testáveis)

**Files:**
- Create: `apps/server/src/tools/tasks.ts`, `apps/server/src/tools/shopping.ts`
- Test: `apps/server/src/tools/tasks.test.ts`, `apps/server/src/tools/shopping.test.ts`

**Interfaces:**
- Consumes: tipos/funções da Task 1; `ChatIdentity`.
- Produces:
  - `buildTaskTools(identity: ChatIdentity, deps?: TaskToolDeps): ToolSet` — tools `tasks_list`, `tasks_add`, `tasks_complete`, `tasks_update`. Cada uma tem parâmetro `owner: z.enum(['luis','esposa']).optional()`; resolução: `owner ?? identity.subject`; se resultar null (grupo sem owner) retorna string pedindo para especificar de quem é. `TaskToolDeps = { getUserBySubject; listTasks; addTask; completeTask; updateTask }` com defaults reais.
  - `buildShoppingTools(identity: ChatIdentity, deps?: ShoppingToolDeps): ToolSet` — `shopping_list`, `shopping_add({ items: string[] })`, `shopping_remove({ item_id })`, `shopping_clear` (o agente confirma na conversa antes de chamar; a tool executa direto). `addedBy` = user do identity quando privado, null no grupo.

Comportamento das respostas: strings PT-BR compactas; `tasks_list` e `shopping_list` retornam `JSON.stringify` (com ids) para o modelo formatar.

- [ ] **Step 1: Testes (falhando)** — `tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildTaskTools, type TaskToolDeps } from './tasks.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const deps: TaskToolDeps = {
    getUserBySubject: async (s) => ({ id: `uid-${s}`, name: s, calendarId: null }),
    listTasks: async (uid) => {
      calls.push(`list:${uid}`);
      return [{ id: 't1', title: 'Pagar boleto', status: 'open', dueDate: '2026-07-15' }];
    },
    addTask: async (uid, title, due) => {
      calls.push(`add:${uid}:${title}:${due ?? '-'}`);
      return { id: 't2', title, status: 'open', dueDate: due ?? null };
    },
    completeTask: async (id) => {
      calls.push(`done:${id}`);
    },
    updateTask: async (id, patch) => {
      calls.push(`upd:${id}:${JSON.stringify(patch)}`);
    },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildTaskTools', () => {
  it('privado: owner default é o dono do chat', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(luis, deps), 'tasks_add', { title: 'Comprar ração' });
    expect(calls).toEqual(['add:uid-luis:Comprar ração:-']);
    expect(out).toContain('Comprar ração');
  });

  it('grupo sem owner: pede para especificar', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', {});
    expect(calls).toEqual([]);
    expect(out.toLowerCase()).toContain('de quem');
  });

  it('grupo com owner explícito funciona', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildTaskTools(grupo, deps), 'tasks_list', { owner: 'esposa' });
    expect(calls).toEqual(['list:uid-esposa']);
    expect(out).toContain('Pagar boleto');
  });

  it('erro do repo vira mensagem amigável', async () => {
    const { deps } = makeDeps();
    deps.listTasks = async () => {
      throw new Error('boom');
    };
    const out = await exec(buildTaskTools(luis, deps), 'tasks_list', {});
    expect(out.toLowerCase()).toContain('não consegui');
  });
});
```

`shopping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildShoppingTools, type ShoppingToolDeps } from './shopping.js';

const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };

function makeDeps() {
  const calls: string[] = [];
  const deps: ShoppingToolDeps = {
    getUserBySubject: async (s) => ({ id: `uid-${s}`, name: s, calendarId: null }),
    listItems: async () => [{ id: 'i1', name: 'Leite' }],
    addItems: async (names, by) => {
      calls.push(`add:${names.join(',')}:${by ?? 'null'}`);
    },
    removeItem: async (id) => {
      calls.push(`rm:${id}`);
    },
    clearItems: async () => {
      calls.push('clear');
    },
  };
  return { deps, calls };
}

async function exec(tools: Record<string, any>, name: string, input: unknown) {
  return tools[name].execute(input, {} as never);
}

describe('buildShoppingTools', () => {
  it('adiciona vários itens de uma vez', async () => {
    const { deps, calls } = makeDeps();
    const out = await exec(buildShoppingTools(grupo, deps), 'shopping_add', {
      items: ['Leite', 'Ovos'],
    });
    expect(calls).toEqual(['add:Leite,Ovos:null']);
    expect(out).toContain('2');
  });

  it('lista itens', async () => {
    const { deps } = makeDeps();
    const out = await exec(buildShoppingTools(grupo, deps), 'shopping_list', {});
    expect(out).toContain('Leite');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → módulos não existem.

- [ ] **Step 3: Implementar `tools/tasks.ts`**

```ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject, type UserRecord } from '../db/chats.js';
import { addTask, completeTask, listTasks, updateTask, type Task } from '../db/tasks.js';

export type TaskToolDeps = {
  getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>;
  listTasks: typeof listTasks;
  addTask: typeof addTask;
  completeTask: typeof completeTask;
  updateTask: typeof updateTask;
};

const defaultDeps: TaskToolDeps = { getUserBySubject, listTasks, addTask, completeTask, updateTask };

const ownerParam = z
  .enum(['luis', 'esposa'])
  .optional()
  .describe('De quem é a tarefa; obrigatório no grupo, no privado o padrão é o dono do chat');

const ASK_OWNER = 'Preciso saber de quem é a tarefa — especifique owner: luis ou esposa.';
const FAIL = 'Não consegui acessar as tarefas agora. Tenta de novo em instantes.';

async function resolveUser(
  deps: TaskToolDeps,
  identity: ChatIdentity,
  owner?: 'luis' | 'esposa',
): Promise<UserRecord | null> {
  const subject = owner ?? identity.subject;
  if (!subject) return null;
  return deps.getUserBySubject(subject);
}

export function buildTaskTools(identity: ChatIdentity, deps: TaskToolDeps = defaultDeps): ToolSet {
  return {
    tasks_list: tool({
      description: 'Lista tarefas de uma pessoa (abertas por padrão).',
      inputSchema: z.object({ owner: ownerParam, status: z.enum(['open', 'done']).optional() }),
      execute: async ({ owner, status }) => {
        const user = await resolveUser(deps, identity, owner).catch(() => null);
        if (!user) return ASK_OWNER;
        try {
          const tasks = await deps.listTasks(user.id, status ?? 'open');
          if (tasks.length === 0)
            return `Nenhuma tarefa ${status === 'done' ? 'concluída' : 'aberta'} de ${user.name}.`;
          return JSON.stringify(tasks.map((t: Task) => ({ id: t.id, title: t.title, due: t.dueDate })));
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_add: tool({
      description: 'Cria uma tarefa para uma pessoa, com prazo opcional (YYYY-MM-DD).',
      inputSchema: z.object({
        title: z.string(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        owner: ownerParam,
      }),
      execute: async ({ title, due_date, owner }) => {
        const user = await resolveUser(deps, identity, owner).catch(() => null);
        if (!user) return ASK_OWNER;
        try {
          const t = await deps.addTask(user.id, title, due_date);
          return `Tarefa criada para ${user.name}: "${t.title}"${t.dueDate ? ` (prazo ${t.dueDate})` : ''}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_complete: tool({
      description: 'Marca uma tarefa como concluída (use o id retornado por tasks_list).',
      inputSchema: z.object({ task_id: z.string() }),
      execute: async ({ task_id }) => {
        try {
          await deps.completeTask(task_id);
          return 'Tarefa concluída. 🎉';
        } catch {
          return FAIL;
        }
      },
    }),
    tasks_update: tool({
      description: 'Altera título e/ou prazo de uma tarefa (due_date null remove o prazo).',
      inputSchema: z.object({
        task_id: z.string(),
        title: z.string().optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      execute: async ({ task_id, title, due_date }) => {
        try {
          await deps.updateTask(task_id, { title, dueDate: due_date });
          return 'Tarefa atualizada.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
```

- [ ] **Step 4: Implementar `tools/shopping.ts`**

```ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ChatIdentity } from '../db/chats.js';
import { getUserBySubject, type UserRecord } from '../db/chats.js';
import { addItems, clearItems, listItems, removeItem } from '../db/shopping.js';

export type ShoppingToolDeps = {
  getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>;
  listItems: typeof listItems;
  addItems: typeof addItems;
  removeItem: typeof removeItem;
  clearItems: typeof clearItems;
};

const defaultDeps: ShoppingToolDeps = { getUserBySubject, listItems, addItems, removeItem, clearItems };
const FAIL = 'Não consegui acessar a lista de compras agora. Tenta de novo em instantes.';

export function buildShoppingTools(
  identity: ChatIdentity,
  deps: ShoppingToolDeps = defaultDeps,
): ToolSet {
  return {
    shopping_list: tool({
      description: 'Mostra a lista de compras compartilhada do casal.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const items = await deps.listItems();
          if (items.length === 0) return 'A lista de compras está vazia.';
          return JSON.stringify(items);
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_add: tool({
      description: 'Adiciona um ou mais itens à lista de compras.',
      inputSchema: z.object({ items: z.array(z.string()).min(1) }),
      execute: async ({ items }) => {
        try {
          const by = identity.subject
            ? ((await deps.getUserBySubject(identity.subject))?.id ?? null)
            : null;
          await deps.addItems(items, by);
          return `${items.length} item(ns) adicionados à lista.`;
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_remove: tool({
      description: 'Remove um item da lista (use o id retornado por shopping_list).',
      inputSchema: z.object({ item_id: z.string() }),
      execute: async ({ item_id }) => {
        try {
          await deps.removeItem(item_id);
          return 'Item removido.';
        } catch {
          return FAIL;
        }
      },
    }),
    shopping_clear: tool({
      description: 'Esvazia a lista de compras. Confirme com o usuário na conversa ANTES de chamar.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          await deps.clearItems();
          return 'Lista de compras esvaziada.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
```

- [ ] **Step 5: Rodar testes, typecheck, commit**

```bash
git add -A && git commit -m "feat: tools de tarefas e lista de compras"
```

---

### Task 4: Tools de agenda (Google Calendar)

**Files:**
- Create: `apps/server/src/tools/calendar.ts`
- Test: `apps/server/src/tools/calendar.test.ts`

**Interfaces:**
- Consumes: `getUserBySubject`, `ChatIdentity`.
- Produces:
  - Interface fina própria (tools NÃO importam googleapis — testabilidade):
    ```ts
    export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean };
    export type CalEventBody = {
      title: string;
      startIso?: string;  // datetime ISO (eventos com hora)
      endIso?: string;
      startDate?: string; // YYYY-MM-DD (all_day)
      endDate?: string;
    };
    export type CalendarApi = {
      listEvents(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<CalEvent[]>;
      insertEvent(calendarId: string, body: CalEventBody): Promise<CalEvent>;
      patchEvent(calendarId: string, eventId: string, body: Partial<CalEventBody>): Promise<void>;
      deleteEvent(calendarId: string, eventId: string): Promise<void>;
    };
    ```
  - `calendarApiFromGoogle(client: calendar_v3.Calendar, timezone: string): CalendarApi` — tradução para googleapis (`events.list` com `singleEvents: true, orderBy: 'startTime'`; `events.insert/patch/delete`; datetime com `timeZone`).
  - `type CalendarToolDeps = { getUserBySubject: (s: 'luis' | 'esposa') => Promise<UserRecord | null>; calendar: CalendarApi; timezone: string }`
  - `buildCalendarTools(identity: ChatIdentity, deps: CalendarToolDeps): ToolSet` — `calendar_list_events({ from_date, to_date, owner? })` (YYYY-MM-DD; to_date inclusivo — converter para fim do dia), `calendar_create_event({ title, start?, end?, all_day?, date?, owner? })` (com hora: `start` ISO, `end` default +1h; all_day: `date` YYYY-MM-DD), `calendar_update_event({ event_id, owner?, title?, start?, end? })`, `calendar_delete_event({ event_id, owner? })`.
  - Resolução de agenda: `owner ?? identity.subject` → `getUserBySubject(...)`; grupo sem owner → pedir owner; `calendarId` null → `"A agenda de <nome> ainda não foi configurada (users.calendar_id)."`. Erros da API → `'Não consegui acessar a agenda agora. Tenta de novo em instantes.'`.
  - Helper exportado `zonedDayStartIso(date: string, tz: string): string` (e `zonedDayEndIso`) — offset real do timezone naquele dia via `Intl.DateTimeFormat` (NUNCA hardcodar `-03:00`).

- [ ] **Step 1: Testes (falhando)** — `calendar.test.ts` no estilo concreto da Task 3 (fake `CalendarApi` registrando chamadas), cobrindo 7 casos:
  1. criar evento com hora no privado do Luis → `insertEvent` chamado com `calendarId` do Luis e `startIso`;
  2. criar evento all_day (`all_day: true, date: '2026-07-20'`) → `insertEvent` com `startDate`;
  3. grupo sem owner → pede owner, nenhuma chamada;
  4. `calendarId` null → mensagem contém "não foi configurada", nenhuma chamada;
  5. `calendar_list_events` retorna JSON com os eventos do fake;
  6. fake lança erro → mensagem amigável contém "não consegui";
  7. `zonedDayStartIso('2026-07-20', 'America/Sao_Paulo')` termina em `-03:00`.

- [ ] **Step 2: Rodar e ver falhar** — `npm test`.

- [ ] **Step 3: Implementar `tools/calendar.ts`** conforme as interfaces acima.

- [ ] **Step 4: Testes verdes, typecheck, commit**

```bash
git add -A && git commit -m "feat: tools de agenda no Google Calendar"
```

---

### Task 5: Wiring no agente + prompts

**Files:**
- Modify: `apps/server/src/agent/agent.ts`, `apps/server/src/agent/agent.test.ts`, `apps/server/src/agent/prompts.ts`, `apps/server/src/agent/prompts.test.ts`

**Interfaces:**
- `buildTools(identity: ChatIdentity): ToolSet` — merge de: save_memory (existente) + `buildTaskTools(identity)` + `buildShoppingTools(identity)` + (`hasGoogleCreds(getConfig())` ? `buildCalendarTools(identity, { getUserBySubject, calendar: calendarApiFromGoogle(getCalendarClient(cfg), cfg.TIMEZONE), timezone: cfg.TIMEZONE })` : nada).
- `AgentDeps.tools: ToolSet` **vira** `AgentDeps.buildTools: (identity: ChatIdentity) => ToolSet`; `handleMessage` chama `deps.buildTools(identity)` após resolver a identidade; `defaultAgentDeps` ajustado.

Prompt (`buildSystemPrompt`): bloco de capacidades — tarefas por pessoa (no grupo especificar de quem), agenda de cada um (datas relativas resolvidas com a data atual já presente no prompt; owner default = quem pede), lista de compras do casal (vive no grupo mas acessível nos privados); instruções: para concluir/remover, liste antes para obter o id; confirme com o usuário antes de `shopping_clear` e `calendar_delete_event`.

- [ ] **Step 1: Ajustar testes (falhando)** — `agent.test.ts`: `tools: {}` → `buildTools: () => ({})`; novo teste: `handleMessage` chama `buildTools` com a identidade resolvida (fake registra o argumento e o teste compara com `luis`). `prompts.test.ts`: prompt privado menciona "tarefas" e "agenda"; prompt do grupo menciona "lista de compras".
- [ ] **Step 2: Implementar e ver passar** — `npm test && npm run typecheck`.
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: tools por identidade de chat e prompts com capacidades da fase 2"
```

---

### Task 6: SETUP/DEPLOY + gates finais

**Files:**
- Modify: `SETUP.md` (seção "Fase 2"), `DEPLOY.md` (nota das vars Google no `.env` do VPS)

- [ ] **Step 1: SETUP.md — seção Fase 2** (PT-BR, estilo existente):
  1. Rodar `supabase/migrations/0002_fase2.sql` (SQL Editor ou via controller/Management API).
  2. Descomentar `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` no `.env` (valores da v1 já estão no arquivo local, comentados).
  3. `npm run google:calendars` → anotar o id da agenda "Esposa".
  4. SQL: `update users set calendar_id = 'primary' where subject = 'luis'; update users set calendar_id = 'ID_DA_AGENDA_ESPOSA' where subject = 'esposa';`
  5. No VPS: acrescentar as 3 vars Google ao `~/assistente-pessoal-v2/.env` e `FORCE=1 bash scripts/deploy-pull.sh`.
- [ ] **Step 2: DEPLOY.md** — na lista de `.env`, mencionar as vars Google (Fase 2+).
- [ ] **Step 3: Gates finais** — `npm test && npm run typecheck && npm run build` verdes.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: setup e deploy da fase 2"
```

**UAT (humano, pós-deploy):** criar/listar/concluir tarefa no seu privado; esposa cria tarefa no privado dela; no grupo "adiciona leite e ovos na lista" e "o que tem na lista?"; "marca dentista quinta às 15h" (evento aparece na agenda certa no Google Calendar); "o que tenho na agenda semana que vem?"; criar evento na agenda da esposa a partir do SEU privado; datas relativas ("amanhã", "sexta") resolvem no fuso de São Paulo.

## Self-review (na escrita do plano)

- Cobertura da spec (Fase 2): tarefas ✓ (T1/T3), agenda 2 pessoas ✓ (T2/T4), compras ✓ (T1/T3), esposa usuária plena ✓ (escopo por identidade, T5), conversa natural ✓ (tools + prompt, T5), docs ✓ (T6).
- Placeholders: T4 Step 1 descreve os 7 testes por comportamento com referência ao estilo concreto e completo da T3 (padrão aceito na Fase 1 para casos espelhados); todo o resto tem código completo.
- Consistência de tipos: `ChatIdentity`/`UserRecord`/`Task`/`ToolSet`/`CalendarApi` conferidos entre tasks; `AgentDeps.buildTools` substitui `tools` e a T5 atualiza produtor e consumidores juntos.
