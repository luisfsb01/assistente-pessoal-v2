# Fase 8 — Web app: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app ganha controle do assistente (memórias com edição+re-embedding, custo LLM vs teto, silêncio/teto e horários+on/off das 4 rotinas) e CRUD de tarefas, compras, hábitos e projetos — sem abrir o chat.

**Architecture:** Abordagem híbrida (spec §2): CRUD direto do web no Supabase (supabase-js + Auth + policies da migração 0007, já escrita) no padrão das páginas de finanças; API Hono só onde precisa do servidor — `PUT /api/memories/:id` (re-embedding) e `GET /api/llm-cost` (gasto+teto), autenticados pelo access token do Supabase. As 4 rotinas visíveis (briefing, casal, revisão financeira, check-in) deixam de ser crons fixos e viram um tick de 1 min que lê `app_state.routines_config`.

**Tech Stack:** Node 22, TypeScript ESM NodeNext, Hono, node-cron, Supabase PostgREST, vitest (servidor); React 19 + Vite + Tailwind 4 + react-router 7 (web).

**Spec:** `docs/superpowers/specs/2026-07-16-fase8-webapp-design.md`

## Global Constraints

- Imports relativos no servidor SEMPRE terminam em `.js` (ESM NodeNext); ponto e vírgula; aspas simples; strings/comentários em PT-BR. No web (apps/web): sem ponto e vírgula (padrão dos arquivos atuais), aspas simples.
- Testes: vitest da raiz (`npx vitest run <caminho>`); só `apps/server/src/**/*.test.ts` roda (vitest.config.ts). Teste que importe (mesmo transitivamente) `db/client.ts` tem `import '../test-setup.js';` como PRIMEIRO import. Fakes, nunca rede.
- **Web NÃO tem runner de testes** (backlog conhecido da F1.5) — páginas são validadas por `npm run web:build` (tsc -b + vite build) e smoke manual. Não criar script de teste no web nesta fase.
- Migração `supabase/migrations/0007_fase8.sql` JÁ EXISTE no repo (commitada em 7b141d6) e NÃO foi aplicada em produção — aplicar só no deploy da fase (SETUP.md, Task 9).
- Toda escrita do web em projeto (nota, status, tarefa criada/movida) toca `projects.updated_at` — base do coletor "projeto parado ≥10d".
- UI: classes utilitárias existentes (`card`, `input`, `btn-primary`, `btn-ghost`), `Modal.tsx` para diálogos (nunca `alert()`/`confirm()`), tokens de tema (`text-ink`, `text-muted`, `bg-surface-2`, `border-hairline`), datas `dd/mm`, PT-BR, nunca UUIDs ao usuário.
- Crons internos intocados (reflexão 03:00, bibliotecário 04:00, coletores 30min/2h/06:30, gmail 30min). Semana começa na SEGUNDA (padrão F7).
- Jobs das rotinas continuam SEM passar pelo juiz/teto da F4 — só muda o gatilho (tick em vez de cron fixo).
- Commits frequentes: um por task, mensagem `feat(f8): ...`.

### Interfaces já existentes que esta fase consome (verbatim do código atual)

- `jobs/scheduler.ts`: `startScheduler(bot: Bot)`; crons atuais a substituir: `0 8 * * *`→`runFinanceReview(bot)`, `0 21 * * *`→`runDailyCheckin(sendKb)`, `0 7 * * *`→`runDailyBriefing(send)`, `0 8 * * 6`→`runCoupleBriefing(send)`; `send = (chatId, text) => bot.api.sendMessage(chatId, text).then(() => undefined)`.
- `proactive/rules.ts`: `localTimeHHMM(now: Date, tz: string): string` ('HH:MM').
- `lib/dates.ts`: `todayInTz(tz, now?)`, `addDays(isoDate, days)`.
- `db/state.ts`: `getState<T>(key): Promise<T | null>`, `setState(key, value)`.
- `db/memories.ts`: `updateMemoryContent(id, content, embedding): Promise<void>` (Task 2 muda para `Promise<boolean>`), usada também em `memory/reflection.ts` (ignora o retorno — mudança compatível).
- `db/usage.ts`: `getMonthCostBrl(): Promise<number>` (rpc `sum_month_cost_brl`), `recordUsage(u)`.
- `memory/embeddings.ts`: `embedText(text: string): Promise<number[]>` (registra o custo em `llm_usage` como purpose 'embedding').
- `lib/config.ts`: `getConfig(): Config` com `LLM_BUDGET_BRL: number`, `TIMEZONE: string`.
- `api/server.ts`: `createApp(webDistDir: string): Hono` (health + static + fallback SPA), `startWebServer(cfg)`; teste `api/server.test.ts` usa `app.request()`.
- Web: `lib/supabase.ts` (client), `lib/useSession.ts` (`{ session, loading }`), `components/Modal.tsx` (`{ title, onClose, children, footer? }`), `App.tsx` (Routes), `components/Layout.tsx` (`navLinks` array), `lib/format.ts` (`formatBrl`).
- Tabelas (colunas relevantes): `tasks(id, user_id, title, status 'open'|'done', due_date, created_at, done_at)`; `shopping_items(id, name, added_by, created_at)`; `habits(id, user_id, name, target_per_week 1–7, active)`; `habit_checkins(id, habit_id, date, done, unique(habit_id,date))`; `projects(id, user_id, name, status, active, updated_at)`; `project_notes(id, project_id, kind 'status'|'decision'|'note', content, created_at)`; `project_tasks(id, project_id, title, status 'todo'|'doing'|'done', due_date, done_at)`; `memories(id, subject 'luis'|'esposa'|'casal', type 'preference'|'habit'|'fact'|'decision'|'person', content, active, expires_at, updated_at)`; `users(id, name, subject)`; `app_state(key, value jsonb)`.

---

### Task 1: Rotinas configuráveis — `jobs/routines.ts` + tick no scheduler

**Files:**
- Create: `apps/server/src/jobs/routines.ts`
- Create: `apps/server/src/jobs/routines.test.ts`
- Modify: `apps/server/src/lib/dates.ts` (adicionar `weekdayInTz`)
- Modify: `apps/server/src/lib/dates.test.ts` (casos do `weekdayInTz`)
- Modify: `apps/server/src/jobs/scheduler.ts` (4 crons → tick de 1 min)

**Interfaces:**
- Consumes: `getState` de `../db/state.js`; `localTimeHHMM` de `../proactive/rules.js`.
- Produces (usadas pelas Tasks 8 e pelo scheduler):
  - `type RoutineKey = 'briefing' | 'coupleBriefing' | 'financeReview' | 'checkin'`
  - `type RoutineSetting = { time: string; enabled: boolean }`
  - `type RoutinesConfig = Record<RoutineKey, RoutineSetting>`
  - `const DEFAULT_ROUTINES: RoutinesConfig` (07:00/08:00/08:00/21:00, todos enabled)
  - `dueRoutines(hhmm: string, weekday: number, cfg: RoutinesConfig): RoutineKey[]` (pura; `coupleBriefing` só com `weekday === 6`)
  - `getRoutinesConfig(getStateFn?): Promise<RoutinesConfig>` (merge POR ROTINA com defaults)
  - `weekdayInTz(tz: string, now?: Date): number` (0=domingo..6=sábado) em `lib/dates.ts`

- [ ] **Step 1: Escrever os testes que falham**

`apps/server/src/jobs/routines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTINES, dueRoutines, getRoutinesConfig, type RoutinesConfig } from './routines.js';

const cfg: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true },
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
};

describe('dueRoutines', () => {
  it('dispara a rotina cujo horário bate', () => {
    expect(dueRoutines('07:00', 3, cfg)).toEqual(['briefing']);
    expect(dueRoutines('21:00', 3, cfg)).toEqual(['checkin']);
  });

  it('horário sem rotina não dispara nada', () => {
    expect(dueRoutines('07:01', 3, cfg)).toEqual([]);
  });

  it('enabled=false não dispara', () => {
    const off = { ...cfg, checkin: { time: '21:00', enabled: false } };
    expect(dueRoutines('21:00', 3, off)).toEqual([]);
  });

  it('briefing do casal só dispara no sábado', () => {
    expect(dueRoutines('08:00', 6, cfg)).toEqual(['coupleBriefing', 'financeReview']);
    expect(dueRoutines('08:00', 0, cfg)).toEqual(['financeReview']);
    expect(dueRoutines('08:00', 2, cfg)).toEqual(['financeReview']);
  });

  it('duas rotinas no mesmo horário disparam juntas', () => {
    const same = { ...cfg, briefing: { time: '08:00', enabled: true } };
    expect(dueRoutines('08:00', 6, same)).toEqual(['briefing', 'coupleBriefing', 'financeReview']);
  });
});

describe('getRoutinesConfig', () => {
  it('sem estado salvo retorna os defaults', async () => {
    const result = await getRoutinesConfig(async () => null);
    expect(result).toEqual(DEFAULT_ROUTINES);
  });

  it('mescla parciais por rotina com os defaults', async () => {
    const result = await getRoutinesConfig(async <T,>() =>
      ({ checkin: { time: '20:30' }, briefing: { enabled: false } }) as T,
    );
    expect(result.checkin).toEqual({ time: '20:30', enabled: true });
    expect(result.briefing).toEqual({ time: '07:00', enabled: false });
    expect(result.financeReview).toEqual({ time: '08:00', enabled: true });
  });
});
```

Adicionar em `apps/server/src/lib/dates.test.ts` (dentro do arquivo existente):

```ts
describe('weekdayInTz', () => {
  it('retorna 6 para um sábado em São Paulo', () => {
    // 2026-07-18 12:00 UTC é sábado em São Paulo (09:00 local)
    expect(weekdayInTz('America/Sao_Paulo', new Date('2026-07-18T12:00:00Z'))).toBe(6);
  });

  it('vira o dia pelo fuso: 00:30 UTC de domingo ainda é sábado em São Paulo', () => {
    expect(weekdayInTz('America/Sao_Paulo', new Date('2026-07-19T00:30:00Z'))).toBe(6);
  });
});
```

(ajustar o import do topo do arquivo para incluir `weekdayInTz`)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/server/src/jobs/routines.test.ts apps/server/src/lib/dates.test.ts`
Expected: FAIL (módulo `routines.js` não existe; `weekdayInTz` não exportado)

- [ ] **Step 3: Implementar**

`apps/server/src/jobs/routines.ts`:

```ts
import { getState } from '../db/state.js';

export type RoutineKey = 'briefing' | 'coupleBriefing' | 'financeReview' | 'checkin';
export type RoutineSetting = { time: string; enabled: boolean };
export type RoutinesConfig = Record<RoutineKey, RoutineSetting>;

export const DEFAULT_ROUTINES: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true }, // só sábado
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
};

const KEYS: RoutineKey[] = ['briefing', 'coupleBriefing', 'financeReview', 'checkin'];

/** Rotinas a disparar neste minuto (hhmm local; weekday 0=domingo..6=sábado). */
export function dueRoutines(hhmm: string, weekday: number, cfg: RoutinesConfig): RoutineKey[] {
  return KEYS.filter((key) => {
    const r = cfg[key];
    if (!r.enabled || r.time !== hhmm) return false;
    if (key === 'coupleBriefing' && weekday !== 6) return false;
    return true;
  });
}

/** Config das rotinas do app_state (edição via web, Fase 8), mesclada POR ROTINA com os defaults. */
export async function getRoutinesConfig(
  getStateFn: <T>(key: string) => Promise<T | null> = getState,
): Promise<RoutinesConfig> {
  const stored = await getStateFn<Partial<Record<RoutineKey, Partial<RoutineSetting>>>>('routines_config');
  const cfg = {} as RoutinesConfig;
  for (const key of KEYS) cfg[key] = { ...DEFAULT_ROUTINES[key], ...(stored?.[key] ?? {}) };
  return cfg;
}
```

Adicionar em `apps/server/src/lib/dates.ts`:

```ts
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dia da semana (0=domingo..6=sábado) de um instante num fuso. */
export function weekdayInTz(tz: string, now: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  return WEEKDAY_NAMES.indexOf(name);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/jobs/routines.test.ts apps/server/src/lib/dates.test.ts`
Expected: PASS

- [ ] **Step 5: Trocar os 4 crons pelo tick no scheduler**

Em `apps/server/src/jobs/scheduler.ts`: REMOVER os 4 blocos `cron.schedule` das rotinas visíveis (`'0 8 * * *'` finance-review, `'0 21 * * *'` check-in, `'0 7 * * *'` briefing, `'0 8 * * 6'` casal) e adicionar no lugar (mantendo todos os outros crons):

```ts
import { localTimeHHMM } from '../proactive/rules.js';
import { weekdayInTz } from '../lib/dates.js';
import { dueRoutines, getRoutinesConfig, type RoutineKey } from './routines.js';

// dentro de startScheduler, após a definição de `send`/`cycle`:

// Rotinas visíveis (Fase 8): horário e on/off vêm do app_state.routines_config
// (editável no web; mudança vale no minuto seguinte, sem restart).
const routineJobs: Record<RoutineKey, () => Promise<void>> = {
  briefing: () => runDailyBriefing(send),
  coupleBriefing: () => runCoupleBriefing(send),
  financeReview: () => runFinanceReview(bot),
  checkin: () =>
    runDailyCheckin((chatId, text, kb) =>
      bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
    ),
};
cron.schedule('* * * * *', () => {
  const now = new Date();
  getRoutinesConfig()
    .then((rc) => {
      const due = dueRoutines(localTimeHHMM(now, cfg.TIMEZONE), weekdayInTz(cfg.TIMEZONE, now), rc);
      for (const key of due) routineJobs[key]().catch((err) => console.error(`[job:${key}]`, err));
    })
    .catch((err) => console.error('[scheduler:tick]', err));
}, opts);
```

Atualizar o `console.log` final do scheduler para refletir que briefing/casal/revisão/check-in agora saem do `routines_config` (ex.: `rotinas via routines_config (defaults 07:00, sáb 08:00, 08:00, 21:00)`).

- [ ] **Step 6: Typecheck + suite**

Run: `npm run typecheck && npx vitest run apps/server/src/jobs`
Expected: sem erros; testes PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/jobs/routines.ts apps/server/src/jobs/routines.test.ts apps/server/src/lib/dates.ts apps/server/src/lib/dates.test.ts apps/server/src/jobs/scheduler.ts
git commit -m "feat(f8): rotinas com horário e on/off configuráveis (tick de 1 min lendo routines_config)"
```

---

### Task 2: API autenticada — `PUT /api/memories/:id` + `GET /api/llm-cost`

**Files:**
- Create: `apps/server/src/api/auth.ts`
- Create: `apps/server/src/api/auth.test.ts`
- Modify: `supabase/migrations/0007_fase8.sql` (adicionar função `month_cost_by_purpose`)
- Modify: `apps/server/src/db/usage.ts` (adicionar `getMonthCostByPurpose`)
- Modify: `apps/server/src/db/memories.ts` (`updateMemoryContent` retorna boolean)
- Modify: `apps/server/src/api/server.ts` (rotas /api com deps injetáveis)
- Modify: `apps/server/src/api/server.test.ts` (testes das rotas)

**Interfaces:**
- Consumes: `embedText` (`../memory/embeddings.js`), `getMonthCostBrl` (`../db/usage.js`), `getConfig` (`../lib/config.js`), `supabase` (`../db/client.js`).
- Produces (usadas pelas Tasks 7 e 8 do web):
  - `PUT /api/memories/:id` body `{ content: string }` → 200 `{ ok: true }` | 400 content vazio | 401 sem/JWT inválido | 404 id inexistente.
  - `GET /api/llm-cost` → 200 `{ spentBrl: number, budgetBrl: number, byPurpose: Array<{ purpose: string; costBrl: number }> }` | 401.
  - `bearerToken(header: string | undefined): string | null` e `isValidAccessToken(token): Promise<boolean>` em `api/auth.ts`.
  - `createApp(webDistDir: string, deps?: ApiDeps): Hono` com `type ApiDeps = { isValidToken(token: string): Promise<boolean>; embedText(text: string): Promise<number[]>; updateMemoryContent(id: string, content: string, embedding: number[]): Promise<boolean>; getMonthCostBrl(): Promise<number>; getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>>; budgetBrl(): number }` e `defaultApiDeps(): ApiDeps`.
  - `db/memories.ts`: `updateMemoryContent(id, content, embedding): Promise<boolean>` (true se a linha existia).
  - `db/usage.ts`: `getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>>` (rpc `month_cost_by_purpose`).

- [ ] **Step 1: Acrescentar a função SQL à migração 0007**

Ao FINAL de `supabase/migrations/0007_fase8.sql` (ainda não aplicada em produção — pode ser editada):

```sql
-- Custo do mês por finalidade (espelha o fuso de sum_month_cost_brl)
create or replace function month_cost_by_purpose()
returns table (purpose text, cost_brl numeric) language sql stable as $$
  select purpose, sum(cost_brl) as cost_brl
  from llm_usage
  where created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
  group by purpose
  order by sum(cost_brl) desc;
$$;
```

- [ ] **Step 2: Escrever os testes que falham**

`apps/server/src/api/auth.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { bearerToken } from './auth.js';

describe('bearerToken', () => {
  it('extrai o token de um header Bearer', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('rejeita header ausente, vazio ou sem Bearer', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
});
```

Em `apps/server/src/api/server.test.ts`: adicionar `import '../test-setup.js';` como PRIMEIRO import (o server.ts passa a importar `db/client.ts` transitivamente) e acrescentar:

```ts
import { createApp, resolveWebDist, type ApiDeps } from './server.js';

function fakeDeps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    isValidToken: async (t) => t === 'token-bom',
    embedText: async () => [0.1, 0.2],
    updateMemoryContent: async () => true,
    getMonthCostBrl: async () => 12.34,
    getMonthCostByPurpose: async () => [{ purpose: 'chat', costBrl: 10 }],
    budgetBrl: () => 50,
    ...over,
  };
}

describe('API /api (Fase 8)', () => {
  const auth = { Authorization: 'Bearer token-bom' };

  it('401 sem token e com token inválido', async () => {
    const app = createApp(dir, fakeDeps());
    expect((await app.request('/api/llm-cost')).status).toBe(401);
    expect(
      (await app.request('/api/llm-cost', { headers: { Authorization: 'Bearer ruim' } })).status,
    ).toBe(401);
  });

  it('GET /api/llm-cost retorna gasto, teto e quebra por finalidade', async () => {
    const app = createApp(dir, fakeDeps());
    const res = await app.request('/api/llm-cost', { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      spentBrl: 12.34,
      budgetBrl: 50,
      byPurpose: [{ purpose: 'chat', costBrl: 10 }],
    });
  });

  it('PUT /api/memories/:id regera o embedding e atualiza', async () => {
    const calls: unknown[] = [];
    const app = createApp(
      dir,
      fakeDeps({
        updateMemoryContent: async (id, content, embedding) => {
          calls.push([id, content, embedding]);
          return true;
        },
      }),
    );
    const res = await app.request('/api/memories/abc-123', {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'novo texto' }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([['abc-123', 'novo texto', [0.1, 0.2]]]);
  });

  it('PUT /api/memories/:id: 400 sem content, 404 id inexistente', async () => {
    const app = createApp(dir, fakeDeps({ updateMemoryContent: async () => false }));
    const sem = await app.request('/api/memories/x', {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '  ' }),
    });
    expect(sem.status).toBe(400);
    const inexistente = await app.request('/api/memories/x', {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'ok' }),
    });
    expect(inexistente.status).toBe(404);
  });

  it('rota /api desconhecida responde 404 (não cai no fallback da SPA)', async () => {
    const app = createApp(dir, fakeDeps());
    const res = await app.request('/api/nada', { headers: auth });
    expect(res.status).toBe(404);
  });
});
```

(reutiliza o `dir` do `describe('createApp')` existente — mover o `beforeAll`/`afterAll` do `dir` para o escopo do arquivo se preciso)

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run apps/server/src/api`
Expected: FAIL (`auth.js` não existe; `ApiDeps` não exportado)

- [ ] **Step 4: Implementar**

`apps/server/src/api/auth.ts`:

```ts
import { supabase } from '../db/client.js';

/** Extrai o token de um header `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Valida um access token do Supabase Auth (o JWT da sessão do web). */
export async function isValidAccessToken(token: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser(token);
  return !error && data.user != null;
}
```

`apps/server/src/db/usage.ts` — adicionar:

```ts
export async function getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>> {
  const { data, error } = await supabase.rpc('month_cost_by_purpose');
  if (error) throw error;
  return (data ?? []).map((r: { purpose: string; cost_brl: number }) => ({
    purpose: r.purpose,
    costBrl: Number(r.cost_brl),
  }));
}
```

`apps/server/src/db/memories.ts` — trocar `updateMemoryContent` por:

```ts
/** Atualiza conteúdo+embedding; retorna false se o id não existe. */
export async function updateMemoryContent(
  id: string,
  content: string,
  embedding: number[],
): Promise<boolean> {
  const { data, error } = await supabase
    .from('memories')
    .update({ content, embedding, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
```

`apps/server/src/api/server.ts` — trocar `createApp` por:

```ts
import { getConfig } from '../lib/config.js';
import { embedText } from '../memory/embeddings.js';
import { updateMemoryContent } from '../db/memories.js';
import { getMonthCostBrl, getMonthCostByPurpose } from '../db/usage.js';
import { bearerToken, isValidAccessToken } from './auth.js';

export type ApiDeps = {
  isValidToken(token: string): Promise<boolean>;
  embedText(text: string): Promise<number[]>;
  updateMemoryContent(id: string, content: string, embedding: number[]): Promise<boolean>;
  getMonthCostBrl(): Promise<number>;
  getMonthCostByPurpose(): Promise<Array<{ purpose: string; costBrl: number }>>;
  budgetBrl(): number;
};

export function defaultApiDeps(): ApiDeps {
  return {
    isValidToken: isValidAccessToken,
    embedText,
    updateMemoryContent,
    getMonthCostBrl,
    getMonthCostByPurpose,
    budgetBrl: () => getConfig().LLM_BUDGET_BRL,
  };
}

/** Monta o app Hono (sem subir servidor) — testável via `app.request()`. */
export function createApp(webDistDir: string, deps: ApiDeps = defaultApiDeps()): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // API do web (Fase 8): autenticada pelo access token do Supabase Auth
  app.use('/api/*', async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token || !(await deps.isValidToken(token))) {
      return c.json({ error: 'não autorizado' }, 401);
    }
    await next();
  });

  app.get('/api/llm-cost', async (c) => {
    const [spentBrl, byPurpose] = await Promise.all([
      deps.getMonthCostBrl(),
      deps.getMonthCostByPurpose(),
    ]);
    return c.json({ spentBrl, budgetBrl: deps.budgetBrl(), byPurpose });
  });

  app.put('/api/memories/:id', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ error: 'content obrigatório' }, 400);
    const embedding = await deps.embedText(content);
    const found = await deps.updateMemoryContent(c.req.param('id'), content, embedding);
    if (!found) return c.json({ error: 'memória não encontrada' }, 404);
    return c.json({ ok: true });
  });

  // /api desconhecida: 404 explícito (não cai no fallback da SPA)
  app.all('/api/*', (c) => c.json({ error: 'rota desconhecida' }, 404));

  app.use('*', serveStatic({ root: webDistDir }));
  app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));

  return app;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run apps/server/src/api`
Expected: PASS (incluindo os testes antigos de health/fallback)

- [ ] **Step 6: Typecheck + suite completa**

Run: `npm run typecheck && npm test`
Expected: sem erros (confirma que `reflection.ts` segue ok com o novo retorno boolean)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0007_fase8.sql apps/server/src/api apps/server/src/db/usage.ts apps/server/src/db/memories.ts
git commit -m "feat(f8): API autenticada — PUT /api/memories/:id (re-embedding) e GET /api/llm-cost"
```

---

### Task 3: Página Tarefas (CRUD) + `useUsers`

**Files:**
- Create: `apps/web/src/lib/useUsers.ts`
- Create: `apps/web/src/pages/Tarefas.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/tarefas`)
- Modify: `apps/web/src/components/Layout.tsx` (item no nav)

**Interfaces:**
- Consumes: `supabase`, `Modal`, policies da 0007 (`tasks`, `users` select).
- Produces (usada pelas Tasks 5 e 6): `useUsers(): { users: AppUser[]; error: string | null }` com `AppUser = { id: string; name: string; subject: 'luis' | 'esposa' }`.

- [ ] **Step 1: Criar `useUsers`**

`apps/web/src/lib/useUsers.ts`:

```tsx
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AppUser {
  id: string
  name: string
  subject: 'luis' | 'esposa'
}

export function useUsers(): { users: AppUser[]; error: string | null } {
  const [users, setUsers] = useState<AppUser[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, subject')
      .order('subject')
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        setUsers((data ?? []) as AppUser[])
      })
  }, [])

  return { users, error }
}
```

- [ ] **Step 2: Criar a página**

`apps/web/src/pages/Tarefas.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { Modal } from '../components/Modal'

interface Task {
  id: string
  user_id: string
  title: string
  status: 'open' | 'done'
  due_date: string | null
  done_at: string | null
}

function formatDue(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function Tarefas() {
  const { users, error: usersError } = useUsers()
  const [items, setItems] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [personFilter, setPersonFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open')

  const [newTitle, setNewTitle] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [newDue, setNewDue] = useState('')
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUserId, setEditUserId] = useState('')
  const [editDue, setEditDue] = useState('')
  const [deleting, setDeleting] = useState<Task | null>(null)

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    let q = supabase.from('tasks').select('*')
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (personFilter !== 'all') q = q.eq('user_id', personFilter)
    const { data, error } = await q
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setItems(data as Task[])
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter, personFilter])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('tasks').insert({
      user_id: newUserId,
      title: newTitle.trim(),
      due_date: newDue || null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewTitle(''); setNewDue('')
    await load()
  }

  async function toggleDone(t: Task) {
    setError(null)
    const done = t.status === 'open'
    const { error } = await supabase
      .from('tasks')
      .update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null })
      .eq('id', t.id)
    if (error) { setError(error.message); return }
    await load()
  }

  function openEdit(t: Task) {
    setEditing(t)
    setEditTitle(t.title)
    setEditUserId(t.user_id)
    setEditDue(t.due_date ?? '')
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editTitle.trim()) return
    setError(null)
    const { error } = await supabase
      .from('tasks')
      .update({ title: editTitle.trim(), user_id: editUserId, due_date: editDue || null })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  async function handleDelete() {
    if (!deleting) return
    setError(null)
    const { error } = await supabase.from('tasks').delete().eq('id', deleting.id)
    if (error) { setError(error.message); return }
    setDeleting(null)
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Tarefas</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Nova tarefa</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Título</label>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required className="input" placeholder="ex.: Levar o carro na revisão" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Pessoa</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-40">
            <label className="text-xs font-medium text-muted">Prazo (opcional)</label>
            <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="input" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="input w-40">
          <option value="all">Todas as pessoas</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input w-40">
          <option value="open">Abertas</option>
          <option value="done">Concluídas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhuma tarefa aqui.</p>}

      <div className="flex flex-col gap-3">
        {items.map((t) => (
          <div key={t.id} className="card flex items-center gap-4 flex-wrap">
            <button
              onClick={() => toggleDone(t)}
              className="shrink-0 w-6 h-6 rounded-full border border-hairline grid place-items-center text-sm"
              title={t.status === 'open' ? 'Concluir' : 'Reabrir'}
            >
              {t.status === 'done' ? '✅' : ''}
            </button>
            <div className="flex-1 min-w-0">
              <span className={`text-sm font-medium ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>
                {t.title}
              </span>
              <span className="ml-2 text-xs text-muted">
                {userName(t.user_id)}{t.due_date ? ` · até ${formatDue(t.due_date)}` : ''}
              </span>
            </div>
            <button onClick={() => openEdit(t)} className="btn-ghost shrink-0">Editar</button>
            <button onClick={() => setDeleting(t)} className="btn-ghost shrink-0 text-red-600">Excluir</button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar tarefa" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required className="input" />
            <select value={editUserId} onChange={(e) => setEditUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Excluir tarefa"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleDelete} className="btn-primary">Excluir</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir “{deleting.title}”?</p>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rota + nav**

Em `apps/web/src/App.tsx`: adicionar `import Tarefas from './pages/Tarefas'` e, dentro do `<Route element={...Layout...}>`, após a rota index:

```tsx
<Route path="/tarefas" element={<Tarefas />} />
```

Em `apps/web/src/components/Layout.tsx`, no array `navLinks`, entre Painel e Transações:

```ts
{ to: '/tarefas',       label: 'Tarefas',        icon: '✅', end: false },
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK, sem erros de tipo

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useUsers.ts apps/web/src/pages/Tarefas.tsx apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(f8): página de tarefas (CRUD por pessoa, prazo, concluir/reabrir)"
```

---

### Task 4: Página Compras

**Files:**
- Create: `apps/web/src/pages/Compras.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/compras`)
- Modify: `apps/web/src/components/Layout.tsx` (item no nav)

**Interfaces:**
- Consumes: `supabase`, `Modal`, policy 0007 em `shopping_items`.
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Criar a página**

`apps/web/src/pages/Compras.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'

interface ShoppingItem {
  id: string
  name: string
}

export default function Compras() {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [editName, setEditName] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('shopping_items')
      .select('id, name')
      .order('created_at', { ascending: true })
    if (error) { setError(error.message); setLoading(false); return }
    setItems(data as ShoppingItem[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('shopping_items').insert({ name: newName.trim() })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName('')
    await load()
  }

  // "Comprado" = sai da lista (a tabela não tem status; mesmo comportamento do chat)
  async function handleBought(id: string) {
    setError(null)
    const { error } = await supabase.from('shopping_items').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setError(null)
    const { error } = await supabase
      .from('shopping_items')
      .update({ name: editName.trim() })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-bold text-ink">Lista de compras</h1>

      <form onSubmit={handleAdd} className="flex gap-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          placeholder="ex.: Café"
          className="input flex-1"
        />
        <button type="submit" disabled={saving} className="btn-primary shrink-0">
          {saving ? 'Adicionando…' : 'Adicionar'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Lista vazia. 🎉</p>}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="card flex items-center gap-3 py-3">
            <button
              onClick={() => handleBought(item.id)}
              className="shrink-0 w-6 h-6 rounded-full border border-hairline hover:bg-surface-2"
              title="Comprado (remove da lista)"
            />
            <span className="flex-1 text-sm text-ink">{item.name}</span>
            <button
              onClick={() => { setEditing(item); setEditName(item.name) }}
              className="btn-ghost shrink-0"
            >
              Editar
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar item" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required className="input" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rota + nav**

`App.tsx`: `import Compras from './pages/Compras'` e `<Route path="/compras" element={<Compras />} />` após a rota de tarefas.
`Layout.tsx` `navLinks`, após Tarefas:

```ts
{ to: '/compras',       label: 'Compras',        icon: '🛒', end: false },
```

- [ ] **Step 3: Build**

Run: `npm run web:build`
Expected: build OK

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Compras.tsx apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(f8): página da lista de compras (adicionar, editar, comprado=remove)"
```

---

### Task 5: Página Hábitos (CRUD + grade de check-ins)

**Files:**
- Create: `apps/web/src/lib/habit-weeks.ts`
- Create: `apps/web/src/pages/Habitos.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/habitos`)
- Modify: `apps/web/src/components/Layout.tsx` (item no nav)

**Interfaces:**
- Consumes: `supabase`, `useUsers` (Task 3), `Modal`, policies 0007 em `habits`/`habit_checkins`.
- Produces: `habit-weeks.ts`: `mondayOf(isoDate: string): string`, `gridWeeks(todayIso: string, weeks: number): string[][]` (matriz semanas×7 de datas ISO, semana começa segunda, última linha = semana corrente).

- [ ] **Step 1: Helpers de datas da grade**

`apps/web/src/lib/habit-weeks.ts`:

```ts
// Datas em ISO local (YYYY-MM-DD), sem Date/fuso: aritmética direta na string
// via Date.UTC para evitar surpresas de timezone no navegador.

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysIso(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000)
}

/** Segunda-feira da semana da data (semana começa na segunda, padrão F7). */
export function mondayOf(iso: string): string {
  const weekday = new Date(toUtc(iso)).getUTCDay() // 0=domingo..6=sábado
  const back = weekday === 0 ? 6 : weekday - 1
  return addDaysIso(iso, -back)
}

/** Matriz de semanas (mais antiga primeiro; última = semana corrente), 7 dias seg→dom. */
export function gridWeeks(todayIso: string, weeks: number): string[][] {
  const currentMonday = mondayOf(todayIso)
  const rows: string[][] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDaysIso(currentMonday, -7 * w)
    rows.push(Array.from({ length: 7 }, (_, d) => addDaysIso(monday, d)))
  }
  return rows
}

export function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

- [ ] **Step 2: Criar a página**

`apps/web/src/pages/Habitos.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { Modal } from '../components/Modal'
import { gridWeeks, todayIso } from '../lib/habit-weeks'

interface Habit {
  id: string
  user_id: string
  name: string
  target_per_week: number
  active: boolean
}

interface Checkin {
  habit_id: string
  date: string
  done: boolean
}

const WEEKS_SHOWN = 5
const DAY_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

export default function Habitos() {
  const { users, error: usersError } = useUsers()
  const [habits, setHabits] = useState<Habit[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('3')
  const [newUserId, setNewUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [editName, setEditName] = useState('')
  const [editTarget, setEditTarget] = useState('3')

  const today = todayIso()
  const weeks = gridWeeks(today, WEEKS_SHOWN)
  const firstDay = weeks[0][0]
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    const { data: hs, error: he } = await supabase
      .from('habits')
      .select('id, user_id, name, target_per_week, active')
      .eq('active', true)
      .order('created_at')
    if (he) { setError(he.message); setLoading(false); return }
    const ids = (hs ?? []).map((h) => h.id)
    let cs: Checkin[] = []
    if (ids.length > 0) {
      const { data, error: ce } = await supabase
        .from('habit_checkins')
        .select('habit_id, date, done')
        .in('habit_id', ids)
        .gte('date', firstDay)
      if (ce) { setError(ce.message); setLoading(false); return }
      cs = data as Checkin[]
    }
    setHabits(hs as Habit[])
    setCheckins(cs)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  function checkinOf(habitId: string, date: string): Checkin | undefined {
    return checkins.find((c) => c.habit_id === habitId && c.date === date)
  }

  function weekProgress(habitId: string): number {
    const currentWeek = weeks[weeks.length - 1]
    return currentWeek.filter((d) => checkinOf(habitId, d)?.done).length
  }

  // Ciclo por clique: sem registro → ✅ → ❌ → sem registro
  async function cycleCheckin(habit: Habit, date: string) {
    if (date > today) return
    setError(null)
    const current = checkinOf(habit.id, date)
    if (!current) {
      const { error } = await supabase
        .from('habit_checkins')
        .upsert({ habit_id: habit.id, date, done: true }, { onConflict: 'habit_id,date' })
      if (error) { setError(error.message); return }
    } else if (current.done) {
      const { error } = await supabase
        .from('habit_checkins')
        .update({ done: false })
        .eq('habit_id', habit.id)
        .eq('date', date)
      if (error) { setError(error.message); return }
    } else {
      const { error } = await supabase
        .from('habit_checkins')
        .delete()
        .eq('habit_id', habit.id)
        .eq('date', date)
      if (error) { setError(error.message); return }
    }
    await load()
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('habits').insert({
      user_id: newUserId,
      name: newName.trim(),
      target_per_week: parseInt(newTarget, 10),
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName(''); setNewTarget('3')
    await load()
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setError(null)
    const { error } = await supabase
      .from('habits')
      .update({ name: editName.trim(), target_per_week: parseInt(editTarget, 10) })
      .eq('id', editing.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  async function handleArchive(habit: Habit) {
    setError(null)
    const { error } = await supabase.from('habits').update({ active: false }).eq('id', habit.id)
    if (error) { setError(error.message); return }
    setEditing(null)
    await load()
  }

  function cellFace(habitId: string, date: string): string {
    const c = checkinOf(habitId, date)
    if (!c) return ''
    return c.done ? '✅' : '❌'
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Hábitos</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Novo hábito</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Nome</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input" placeholder="ex.: Academia" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Pessoa</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-32">
            <label className="text-xs font-medium text-muted">Vezes/semana</label>
            <input type="number" min="1" max="7" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} required className="input" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && habits.length === 0 && (
        <p className="text-sm text-muted">Nenhum hábito ativo — crie acima ou pelo chat.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {habits.map((h) => (
          <div key={h.id} className="card flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{h.name}</p>
                <p className="text-xs text-muted">
                  {userName(h.user_id)} · {weekProgress(h.id)}/{h.target_per_week} nessa semana
                </p>
              </div>
              <button
                onClick={() => { setEditing(h); setEditName(h.name); setEditTarget(String(h.target_per_week)) }}
                className="btn-ghost shrink-0"
              >
                Editar
              </button>
            </div>

            {/* Grade: WEEKS_SHOWN semanas (antiga → corrente), colunas seg→dom */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {DAY_LABELS.map((l, i) => (
                <span key={`l-${i}`} className="text-[10px] text-muted">{l}</span>
              ))}
              {weeks.flat().map((date) => (
                <button
                  key={date}
                  onClick={() => cycleCheckin(h, date)}
                  disabled={date > today}
                  title={date.split('-').reverse().slice(0, 2).join('/')}
                  className={`h-7 rounded text-xs grid place-items-center border border-hairline ${
                    date > today ? 'opacity-30' : 'hover:bg-surface-2'
                  } ${date === today ? 'ring-1 ring-brand-600' : ''}`}
                >
                  {cellFace(h.id, date)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal title="Editar hábito" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required className="input" />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">Vezes/semana</label>
              <input type="number" min="1" max="7" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} required className="input" />
            </div>
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => handleArchive(editing)} className="btn-ghost text-red-600">Arquivar</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
                <button type="submit" className="btn-primary">Salvar</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rota + nav**

`App.tsx`: `import Habitos from './pages/Habitos'` e `<Route path="/habitos" element={<Habitos />} />`.
`Layout.tsx` `navLinks`, após Compras:

```ts
{ to: '/habitos',       label: 'Hábitos',        icon: '🔁', end: false },
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/habit-weeks.ts apps/web/src/pages/Habitos.tsx apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(f8): página de hábitos (CRUD + grade de check-ins clicável, 5 semanas)"
```

---

### Task 6: Páginas Projetos (lista + detalhe com quadro e linha do tempo)

**Files:**
- Create: `apps/web/src/pages/Projetos.tsx`
- Create: `apps/web/src/pages/ProjetoDetalhe.tsx`
- Modify: `apps/web/src/App.tsx` (rotas `/projetos` e `/projetos/:id`)
- Modify: `apps/web/src/components/Layout.tsx` (item no nav)

**Interfaces:**
- Consumes: `supabase`, `useUsers`, `Modal`, policies 0007 em `projects`/`project_notes`/`project_tasks`.
- Produces: nada consumido por outras tasks.
- REGRA: toda escrita (nota, status, tarefa criada/movida/excluída) chama `touchProject(projectId)` — `update projects set updated_at = now()` — para o coletor "projeto parado ≥10d" continuar correto.

- [ ] **Step 1: Página de lista**

`apps/web/src/pages/Projetos.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'

interface Project {
  id: string
  user_id: string
  name: string
  status: string | null
  updated_at: string
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

export default function Projetos() {
  const { users, error: usersError } = useUsers()
  const [items, setItems] = useState<Project[]>([])
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [saving, setSaving] = useState(false)

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('projects')
      .select('id, user_id, name, status, updated_at')
      .eq('active', true)
      .order('updated_at', { ascending: false })
    if (error) { setError(error.message); setLoading(false); return }
    const projects = data as Project[]
    const ids = projects.map((p) => p.id)
    const counts: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: ts, error: te } = await supabase
        .from('project_tasks')
        .select('project_id, status')
        .in('project_id', ids)
        .neq('status', 'done')
      if (te) { setError(te.message); setLoading(false); return }
      for (const t of ts ?? []) counts[t.project_id] = (counts[t.project_id] ?? 0) + 1
    }
    setItems(projects)
    setOpenCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!newUserId && users.length > 0) setNewUserId(users[0].id)
  }, [users])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newUserId) return
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('projects')
      .insert({ user_id: newUserId, name: newName.trim() })
    setSaving(false)
    if (error) { setError(error.message); return }
    setNewName('')
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">Projetos</h1>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-ink">Novo projeto</h3>
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted">Nome</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input" placeholder="ex.: Site" />
          </div>
          <div className="flex flex-col gap-1 w-36">
            <label className="text-xs font-medium text-muted">Dono</label>
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="input">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Criando…' : 'Criar'}</button>
        </form>
      </div>

      {(error || usersError) && <p className="text-sm text-red-600">{error ?? usersError}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhum projeto ativo.</p>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <Link key={p.id} to={`/projetos/${p.id}`} className="card hover:bg-surface-2 transition-colors flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">{p.name}</p>
            {p.status && <p className="text-xs text-ink">{p.status}</p>}
            <p className="text-xs text-muted">
              {userName(p.user_id)} · {openCounts[p.id] ?? 0} tarefa(s) aberta(s) · movimento {daysAgo(p.updated_at)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Página de detalhe**

`apps/web/src/pages/ProjetoDetalhe.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'

interface Project {
  id: string
  name: string
  status: string | null
  active: boolean
}

interface PTask {
  id: string
  title: string
  status: 'todo' | 'doing' | 'done'
  due_date: string | null
}

interface PNote {
  id: string
  kind: 'status' | 'decision' | 'note'
  content: string
  created_at: string
}

const COLUMNS: Array<{ key: PTask['status']; label: string }> = [
  { key: 'todo', label: 'A fazer' },
  { key: 'doing', label: 'Fazendo' },
  { key: 'done', label: 'Feito' },
]

const KIND_LABEL: Record<PNote['kind'], string> = {
  status: 'status', decision: 'decisão', note: 'nota',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDue(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return ` · até ${d}/${m}`
}

export default function ProjetoDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<PTask[]>([])
  const [notes, setNotes] = useState<PNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newTask, setNewTask] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newNoteKind, setNewNoteKind] = useState<PNote['kind']>('note')
  const [statusDraft, setStatusDraft] = useState('')
  const [archiving, setArchiving] = useState(false)

  async function touchProject() {
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { data: p, error: pe } = await supabase
      .from('projects')
      .select('id, name, status, active')
      .eq('id', id)
      .maybeSingle()
    if (pe) { setError(pe.message); setLoading(false); return }
    if (!p) { setError('Projeto não encontrado.'); setLoading(false); return }
    const [{ data: ts, error: te }, { data: ns, error: ne }] = await Promise.all([
      supabase.from('project_tasks').select('id, title, status, due_date').eq('project_id', id).order('created_at'),
      supabase.from('project_notes').select('id, kind, content, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(30),
    ])
    if (te) { setError(te.message); setLoading(false); return }
    if (ne) { setError(ne.message); setLoading(false); return }
    setProject(p as Project)
    setStatusDraft((p as Project).status ?? '')
    setTasks(ts as PTask[])
    setNotes(ns as PNote[])
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function moveTask(t: PTask, dir: -1 | 1) {
    const order: PTask['status'][] = ['todo', 'doing', 'done']
    const next = order[order.indexOf(t.status) + dir]
    if (!next) return
    setError(null)
    const { error } = await supabase
      .from('project_tasks')
      .update({ status: next, done_at: next === 'done' ? new Date().toISOString() : null })
      .eq('id', t.id)
    if (error) { setError(error.message); return }
    await touchProject()
    await load()
  }

  async function deleteTask(t: PTask) {
    setError(null)
    const { error } = await supabase.from('project_tasks').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    await touchProject()
    await load()
  }

  async function handleAddTask(e: FormEvent) {
    e.preventDefault()
    if (!newTask.trim()) return
    setError(null)
    const { error } = await supabase.from('project_tasks').insert({
      project_id: id,
      title: newTask.trim(),
      due_date: newTaskDue || null,
    })
    if (error) { setError(error.message); return }
    setNewTask(''); setNewTaskDue('')
    await touchProject()
    await load()
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault()
    if (!newNote.trim()) return
    setError(null)
    const { error } = await supabase.from('project_notes').insert({
      project_id: id,
      kind: newNoteKind,
      content: newNote.trim(),
    })
    if (error) { setError(error.message); return }
    setNewNote('')
    await touchProject()
    await load()
  }

  // Status novo = campo do projeto + entrada na linha do tempo (espelha o chat)
  async function handleSaveStatus(e: FormEvent) {
    e.preventDefault()
    const status = statusDraft.trim()
    if (!status || status === (project?.status ?? '')) return
    setError(null)
    const { error } = await supabase.from('projects').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { setError(error.message); return }
    const { error: ne } = await supabase.from('project_notes').insert({ project_id: id, kind: 'status', content: status })
    if (ne) { setError(ne.message); return }
    await load()
  }

  async function handleArchive() {
    setError(null)
    const { error } = await supabase
      .from('projects')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { setError(error.message); return }
    navigate('/projetos')
  }

  if (loading) return <p className="text-sm text-muted">Carregando…</p>
  if (!project) return <p className="text-sm text-red-600">{error ?? 'Projeto não encontrado.'}</p>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/projetos" className="btn-ghost shrink-0">←</Link>
        <h1 className="text-2xl font-bold text-ink flex-1">{project.name}</h1>
        <button onClick={() => setArchiving(true)} className="btn-ghost text-red-600 shrink-0">Arquivar</button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Status atual */}
      <form onSubmit={handleSaveStatus} className="card flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
          <label className="text-xs font-medium text-muted">Status atual</label>
          <input type="text" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} className="input" placeholder="ex.: aguardando cliente" />
        </div>
        <button type="submit" className="btn-primary">Atualizar status</button>
      </form>

      {/* Quadro */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.key} className="card flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {col.label} ({tasks.filter((t) => t.status === col.key).length})
            </h3>
            {tasks.filter((t) => t.status === col.key).map((t) => (
              <div key={t.id} className="rounded-lg border border-hairline px-3 py-2 flex items-center gap-2">
                <span className={`flex-1 text-sm ${t.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>
                  {t.title}<span className="text-xs text-muted">{formatDue(t.due_date)}</span>
                </span>
                {t.status !== 'todo' && (
                  <button onClick={() => moveTask(t, -1)} className="btn-ghost px-1" title="Mover para trás">←</button>
                )}
                {t.status !== 'done' && (
                  <button onClick={() => moveTask(t, 1)} className="btn-ghost px-1" title="Avançar">→</button>
                )}
                <button onClick={() => deleteTask(t)} className="btn-ghost px-1 text-red-600" title="Excluir">×</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Nova tarefa */}
      <form onSubmit={handleAddTask} className="card flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted">Nova tarefa</label>
          <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} required className="input" placeholder="ex.: enviar proposta" />
        </div>
        <div className="flex flex-col gap-1 w-40">
          <label className="text-xs font-medium text-muted">Prazo (opcional)</label>
          <input type="date" value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} className="input" />
        </div>
        <button type="submit" className="btn-primary">Adicionar</button>
      </form>

      {/* Linha do tempo */}
      <div className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Linha do tempo</h3>
        <form onSubmit={handleAddNote} className="flex flex-wrap gap-3">
          <select value={newNoteKind} onChange={(e) => setNewNoteKind(e.target.value as PNote['kind'])} className="input w-32">
            <option value="note">Nota</option>
            <option value="decision">Decisão</option>
          </select>
          <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)} required className="input flex-1 min-w-[200px]" placeholder="ex.: decidi usar Astro" />
          <button type="submit" className="btn-primary">Registrar</button>
        </form>
        {notes.length === 0 && <p className="text-sm text-muted">Sem registros ainda.</p>}
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm text-ink flex gap-2">
              <span className="text-xs text-muted shrink-0 w-12">{formatDate(n.created_at)}</span>
              <span className="text-xs text-muted shrink-0 w-16">[{KIND_LABEL[n.kind]}]</span>
              <span className="flex-1">{n.content}</span>
            </li>
          ))}
        </ul>
      </div>

      {archiving && (
        <Modal
          title="Arquivar projeto"
          onClose={() => setArchiving(false)}
          footer={
            <>
              <button onClick={() => setArchiving(false)} className="btn-ghost">Cancelar</button>
              <button onClick={handleArchive} className="btn-primary">Arquivar</button>
            </>
          }
        >
          <p className="text-sm text-ink">Arquivar “{project.name}”? Ele some da lista e do acompanhamento.</p>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rotas + nav**

`App.tsx`: `import Projetos from './pages/Projetos'`, `import ProjetoDetalhe from './pages/ProjetoDetalhe'` e:

```tsx
<Route path="/projetos" element={<Projetos />} />
<Route path="/projetos/:id" element={<ProjetoDetalhe />} />
```

`Layout.tsx` `navLinks`, após Hábitos:

```ts
{ to: '/projetos',      label: 'Projetos',       icon: '📁', end: false },
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Projetos.tsx apps/web/src/pages/ProjetoDetalhe.tsx apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(f8): páginas de projetos (lista + quadro todo/doing/done + linha do tempo)"
```

---

### Task 7: Página Memórias (+ `lib/api.ts` do web)

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/Memorias.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/memorias`)
- Modify: `apps/web/src/components/Layout.tsx` (item no nav)

**Interfaces:**
- Consumes: `supabase` (policies 0007 em `memories`: select/update/delete, SEM insert), `PUT /api/memories/:id` (Task 2), `Modal`.
- Produces (usada pela Task 8): `apiFetch(path: string, init?: RequestInit): Promise<Response>` em `lib/api.ts` (anexa `Authorization: Bearer <access_token>` da sessão).

- [ ] **Step 1: Criar `apiFetch`**

`apps/web/src/lib/api.ts`:

```tsx
import { supabase } from './supabase'

/** fetch autenticado para a API do servidor (Hono) com o JWT da sessão. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  })
}
```

- [ ] **Step 2: Criar a página**

`apps/web/src/pages/Memorias.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { Modal } from '../components/Modal'

interface Memory {
  id: string
  subject: 'luis' | 'esposa' | 'casal'
  type: 'preference' | 'habit' | 'fact' | 'decision' | 'person'
  content: string
  active: boolean
  expires_at: string | null
  updated_at: string
}

const SUBJECT_LABEL: Record<Memory['subject'], string> = {
  luis: 'Luis', esposa: 'Esposa', casal: 'Casal',
}
const TYPE_LABEL: Record<Memory['type'], string> = {
  preference: 'preferência', habit: 'hábito', fact: 'fato', decision: 'decisão', person: 'pessoa',
}
const PAGE = 100

export default function Memorias() {
  const [items, setItems] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const [editing, setEditing] = useState<Memory | null>(null)
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState<Memory | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('memories')
      .select('id, subject, type, content, active, expires_at, updated_at')
    if (subjectFilter !== 'all') q = q.eq('subject', subjectFilter)
    if (typeFilter !== 'all') q = q.eq('type', typeFilter)
    if (statusFilter !== 'all') q = q.eq('active', statusFilter === 'active')
    if (query.trim()) q = q.ilike('content', `%${query.trim()}%`)
    const { data, error } = await q.order('updated_at', { ascending: false }).limit(limit + 1)
    if (error) { setError(error.message); setLoading(false); return }
    const rows = data as Memory[]
    setHasMore(rows.length > limit)
    setItems(rows.slice(0, limit))
    setLoading(false)
  }

  useEffect(() => { load() }, [subjectFilter, typeFilter, statusFilter, query, limit])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    setLimit(PAGE)
    setQuery(search)
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editContent.trim()) return
    setSavingEdit(true)
    setError(null)
    const res = await apiFetch(`/api/memories/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: editContent.trim() }),
    })
    setSavingEdit(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      setError(body?.error ?? `Erro ${res.status} ao salvar a memória`)
      return
    }
    setEditing(null)
    await load()
  }

  async function toggleActive(m: Memory) {
    setError(null)
    const { error } = await supabase.from('memories').update({ active: !m.active }).eq('id', m.id)
    if (error) { setError(error.message); return }
    await load()
  }

  async function handleDelete() {
    if (!deleting) return
    setError(null)
    const { error } = await supabase.from('memories').delete().eq('id', deleting.id)
    if (error) { setError(error.message); return }
    setDeleting(null)
    await load()
  }

  const isExpired = (m: Memory) => m.expires_at != null && new Date(m.expires_at) <= new Date()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Memórias</h1>
        <p className="text-sm text-muted mt-1">Tudo que o assistente sabe — edite, desative ou apague</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <form onSubmit={submitSearch} className="flex gap-2 flex-1 min-w-[220px]">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no conteúdo…" className="input flex-1" />
          <button type="submit" className="btn-primary shrink-0">Buscar</button>
        </form>
        <select value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); setLimit(PAGE) }} className="input w-32">
          <option value="all">Todos</option>
          <option value="luis">Luis</option>
          <option value="esposa">Esposa</option>
          <option value="casal">Casal</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setLimit(PAGE) }} className="input w-36">
          <option value="all">Todos os tipos</option>
          <option value="preference">Preferência</option>
          <option value="habit">Hábito</option>
          <option value="fact">Fato</option>
          <option value="decision">Decisão</option>
          <option value="person">Pessoa</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setLimit(PAGE) }} className="input w-32">
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
          <option value="all">Todas</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">Nenhuma memória encontrada.</p>}

      <div className="flex flex-col gap-2">
        {items.map((m) => (
          <div key={m.id} className={`card flex items-start gap-3 py-3 ${m.active ? '' : 'opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink">{m.content}</p>
              <p className="text-xs text-muted mt-1">
                {SUBJECT_LABEL[m.subject]} · {TYPE_LABEL[m.type]}
                {!m.active && ' · inativa'}
                {isExpired(m) && ' · expirada'}
              </p>
            </div>
            <button onClick={() => { setEditing(m); setEditContent(m.content) }} className="btn-ghost shrink-0">Editar</button>
            <button onClick={() => toggleActive(m)} className="btn-ghost shrink-0">
              {m.active ? 'Desativar' : 'Reativar'}
            </button>
            <button onClick={() => setDeleting(m)} className="btn-ghost shrink-0 text-red-600">Excluir</button>
          </div>
        ))}
      </div>

      {hasMore && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost self-center">
          Carregar mais
        </button>
      )}

      {editing && (
        <Modal title="Editar memória" onClose={() => setEditing(null)}>
          <form onSubmit={handleEdit} className="grid gap-3">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              required
              rows={4}
              className="input"
            />
            <p className="text-xs text-muted">Salvar regera o embedding (uma chamada barata de LLM).</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" disabled={savingEdit} className="btn-primary">
                {savingEdit ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Excluir memória"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} className="btn-ghost">Cancelar</button>
              <button onClick={handleDelete} className="btn-primary">Excluir de vez</button>
            </>
          }
        >
          <p className="text-sm text-ink">Excluir definitivamente esta memória? (Para o assistente só “esquecer”, use Desativar.)</p>
        </Modal>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rota + nav**

`App.tsx`: `import Memorias from './pages/Memorias'` e `<Route path="/memorias" element={<Memorias />} />`.
`Layout.tsx` `navLinks`, após Projetos:

```ts
{ to: '/memorias',      label: 'Memórias',       icon: '🧠', end: false },
```

- [ ] **Step 4: Build**

Run: `npm run web:build`
Expected: build OK

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/Memorias.tsx apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(f8): página de memórias (busca, filtros, editar com re-embedding, desativar, excluir)"
```

---

### Task 8: Configurações — assistente (silêncio/teto + rotinas) e custo LLM

**Files:**
- Modify: `apps/web/src/pages/Configuracoes.tsx`

**Interfaces:**
- Consumes: `supabase` (policy 0007 em `app_state`, chaves `proactivity_config`/`routines_config`), `apiFetch` (Task 7), `GET /api/llm-cost` (Task 2), `formatBrl` de `../lib/format`.
- Defaults DUPLICADOS do servidor de propósito (web não importa código do server): silêncio 22:00–07:00, teto 5; rotinas briefing 07:00 / casal 08:00 (sáb) / revisão 08:00 / check-in 21:00, todas ligadas.

- [ ] **Step 1: Reescrever a página**

`apps/web/src/pages/Configuracoes.tsx` — manter os cards existentes de Aparência e Bancos EXATAMENTE como estão e adicionar os três novos cards. Estrutura completa do arquivo:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useTheme } from '../lib/useTheme'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import { formatBrl } from '../lib/format'

interface ProactivityConfig {
  quietStart: string
  quietEnd: string
  maxNotificationsPerDay: number
}

type RoutineKey = 'briefing' | 'coupleBriefing' | 'financeReview' | 'checkin'
type RoutinesConfig = Record<RoutineKey, { time: string; enabled: boolean }>

interface LlmCost {
  spentBrl: number
  budgetBrl: number
  byPurpose: Array<{ purpose: string; costBrl: number }>
}

// Defaults espelham o servidor (proactive/rules.ts e jobs/routines.ts)
const DEFAULT_PROACTIVITY: ProactivityConfig = {
  quietStart: '22:00', quietEnd: '07:00', maxNotificationsPerDay: 5,
}
const DEFAULT_ROUTINES: RoutinesConfig = {
  briefing: { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true },
  financeReview: { time: '08:00', enabled: true },
  checkin: { time: '21:00', enabled: true },
}
const ROUTINE_LABEL: Record<RoutineKey, string> = {
  briefing: 'Briefing matinal',
  coupleBriefing: 'Briefing do casal (sábados)',
  financeReview: 'Revisão financeira',
  checkin: 'Check-in de hábitos (noite)',
}
const ROUTINE_KEYS: RoutineKey[] = ['briefing', 'coupleBriefing', 'financeReview', 'checkin']

export default function Configuracoes() {
  const { theme, toggle } = useTheme()
  const connectUrl = import.meta.env.VITE_BANCO_MCP_CONNECT_URL as string | undefined

  const [proactivity, setProactivity] = useState<ProactivityConfig>(DEFAULT_PROACTIVITY)
  const [routines, setRoutines] = useState<RoutinesConfig>(DEFAULT_ROUTINES)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [cost, setCost] = useState<LlmCost | null>(null)
  const [costError, setCostError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('app_state')
      .select('key, value')
      .in('key', ['proactivity_config', 'routines_config'])
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        for (const row of data ?? []) {
          if (row.key === 'proactivity_config') {
            setProactivity({ ...DEFAULT_PROACTIVITY, ...(row.value as Partial<ProactivityConfig>) })
          }
          if (row.key === 'routines_config') {
            const stored = row.value as Partial<RoutinesConfig>
            setRoutines((prev) => {
              const next = { ...prev }
              for (const k of ROUTINE_KEYS) next[k] = { ...DEFAULT_ROUTINES[k], ...(stored[k] ?? {}) }
              return next
            })
          }
        }
        setConfigLoaded(true)
      })

    apiFetch('/api/llm-cost').then(async (res) => {
      if (!res.ok) { setCostError(`Erro ${res.status} ao carregar o custo`); return }
      setCost(await res.json() as LlmCost)
    }).catch(() => setCostError('Erro de rede ao carregar o custo'))
  }, [])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const teto = proactivity.maxNotificationsPerDay
    if (!Number.isInteger(teto) || teto < 1 || teto > 20) {
      setError('O teto de notificações deve ser um inteiro entre 1 e 20.')
      return
    }
    setSaving(true)
    setError(null)
    setSaveMsg(null)
    const { error } = await supabase.from('app_state').upsert([
      { key: 'proactivity_config', value: proactivity },
      { key: 'routines_config', value: routines },
    ])
    setSaving(false)
    if (error) { setError(error.message); return }
    setSaveMsg('Salvo — vale a partir do próximo minuto.')
  }

  const pct = cost ? Math.min(100, Math.round((cost.spentBrl / cost.budgetBrl) * 100)) : 0
  const barColor = pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Configurações</h1>
        <p className="text-sm text-muted mt-1">Aparência, integrações e o comportamento do assistente</p>
      </div>

      {/* Aparência — INALTERADO (copiar o card atual daqui do arquivo existente) */}
      {/* Bancos (Open Finance) — INALTERADO (copiar o card atual) */}

      {/* Custo LLM */}
      <div className="card">
        <h2 className="font-semibold text-ink mb-3">Custo de IA no mês</h2>
        {costError && <p className="text-sm text-red-600">{costError}</p>}
        {!cost && !costError && <p className="text-sm text-muted">Carregando…</p>}
        {cost && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-ink">{formatBrl(cost.spentBrl)}</span>
              <span className="text-sm text-muted">teto {formatBrl(cost.budgetBrl)}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            {cost.byPurpose.length > 0 && (
              <table className="text-sm">
                <tbody>
                  {cost.byPurpose.map((p) => (
                    <tr key={p.purpose}>
                      <td className="text-muted py-0.5">{p.purpose}</td>
                      <td className="text-ink text-right">{formatBrl(p.costBrl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Assistente: silêncio, teto e rotinas */}
      <form onSubmit={handleSave} className="card flex flex-col gap-4">
        <h2 className="font-semibold text-ink">Assistente</h2>
        {!configLoaded && <p className="text-sm text-muted">Carregando…</p>}

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Silêncio: início</label>
            <input
              type="time"
              value={proactivity.quietStart}
              onChange={(e) => setProactivity({ ...proactivity, quietStart: e.target.value })}
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Silêncio: fim</label>
            <input
              type="time"
              value={proactivity.quietEnd}
              onChange={(e) => setProactivity({ ...proactivity, quietEnd: e.target.value })}
              className="input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Máx. notificações/dia</label>
            <input
              type="number"
              min="1"
              max="20"
              value={proactivity.maxNotificationsPerDay}
              onChange={(e) => setProactivity({ ...proactivity, maxNotificationsPerDay: parseInt(e.target.value || '0', 10) })}
              className="input w-24"
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          No silêncio, avisos proativos seguram até a manhã. O teto vale por pessoa/dia.
        </p>

        <h3 className="text-sm font-semibold text-ink mt-2">Rotinas</h3>
        <div className="flex flex-col gap-2">
          {ROUTINE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                role="switch"
                aria-checked={routines[key].enabled}
                onClick={() => setRoutines({ ...routines, [key]: { ...routines[key], enabled: !routines[key].enabled } })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  routines[key].enabled ? 'bg-brand-600' : 'bg-surface-2 border border-hairline'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  routines[key].enabled ? 'translate-x-5' : ''
                }`} />
              </button>
              <span className="text-sm text-ink flex-1 min-w-[180px]">{ROUTINE_LABEL[key]}</span>
              <input
                type="time"
                value={routines[key].time}
                onChange={(e) => setRoutines({ ...routines, [key]: { ...routines[key], time: e.target.value } })}
                disabled={!routines[key].enabled}
                className="input w-28"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saveMsg && <p className="text-sm text-ink">{saveMsg}</p>}
        <button type="submit" disabled={saving || !configLoaded} className="btn-primary self-start">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </div>
  )
}
```

(nos comentários `INALTERADO`: colar os dois cards existentes do arquivo atual, sem mudanças — Aparência com o switch de tema e Bancos com o `connectUrl`)

- [ ] **Step 2: Build**

Run: `npm run web:build`
Expected: build OK (`<input type="time">` já entrega valor 'HH:MM' — sem validação extra de formato)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/Configuracoes.tsx
git commit -m "feat(f8): configurações do assistente (silêncio/teto, rotinas com horário e on/off) + custo LLM"
```

---

### Task 9: SETUP.md + verificação final

**Files:**
- Modify: `SETUP.md` (nova seção "## 10. Fase 8")

**Interfaces:**
- Consumes: tudo das tasks anteriores.

- [ ] **Step 1: Documentar o setup da fase**

Adicionar em `SETUP.md`, após a seção "## 9. Fase 7", antes de "## Notas":

```markdown
## 10. Fase 8 (web app: controle do assistente)

1. **Migração**: executar `supabase/migrations/0007_fase8.sql` (SQL Editor ou
   Management API) — policies de RLS para o web + função `month_cost_by_purpose`.
2. Nada novo no `.env`.
3. No web app: páginas novas Tarefas, Compras, Hábitos, Projetos e Memórias;
   em Configurações, o assistente (silêncio, teto, horário e liga/desliga das
   rotinas — mudança vale no minuto seguinte) e o custo de IA do mês vs teto.
4. Os horários das rotinas saem de `app_state.routines_config` (defaults:
   briefing 07:00, casal sáb 08:00, revisão financeira 08:00, check-in 21:00).
```

- [ ] **Step 2: Verificação completa**

Run: `npm run typecheck && npm test && npm run web:build`
Expected: typecheck limpo, suite completa PASS (228+ testes), build do web OK

- [ ] **Step 3: Smoke local (manual)**

Com `.env` local (aponta para o Supabase de produção — cuidado: criar/editar dados de teste e desfazer):
1. `npm run web:dev` + `npm run dev` (bot + API na 8080).
2. Login no web → conferir que as 5 páginas novas carregam sem erro (as tabelas podem estar vazias; ANTES da 0007 aplicada as listas vêm vazias por RLS — aplicar a migração em produção via Management API neste passo, é pré-requisito do UAT).
3. Configurações → salvar um horário de rotina e conferir `app_state.routines_config` no banco.
4. Memórias → editar uma memória e conferir 200 + conteúdo novo.

- [ ] **Step 4: Commit**

```bash
git add SETUP.md
git commit -m "feat(f8): setup da fase 8 (migração 0007 + rotinas configuráveis)"
```

---

## Self-review (feito na escrita do plano)

- **Cobertura da spec**: Tarefas CRUD (T3), Compras (T4), Hábitos+grade (T5), Projetos quadro+timeline+updated_at (T6), Memórias com re-embedding (T7+T2), Configurações silêncio/teto/rotinas + custo (T8+T1+T2), migração 0007 (já commitada; função SQL na T2), SETUP (T9). Fora de escopo respeitado (dashboard, insert de memória pelo web).
- **Tipos consistentes**: `ApiDeps`/`createApp` (T2) ↔ testes; `RoutinesConfig` (T1) ↔ Configurações (T8, duplicado de propósito); `useUsers`/`AppUser` (T3) ↔ T5/T6; `apiFetch` (T7) ↔ T8.
- **Sem placeholders**: todo step de código tem o código; os dois cards "INALTERADO" da T8 são cópia literal do arquivo existente (instrução explícita).
