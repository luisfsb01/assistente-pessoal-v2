# Fase 7 — Hábitos + Projetos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hábitos com meta semanal (check-in 21:00 com botões ✅/❌ um por vez, progresso/retrospectivas no briefing) e projetos por conversa (linha do tempo de status/decisões, quadro to do/doing/done com prazos, tarefa vencida no check-in, projeto parado no motor da F4).

**Architecture:** Tabelas novas (migração 0006) + tools injetáveis no padrão do repo. O check-in das 21:00 é job direto (como o briefing): manda a pergunta do primeiro hábito pendente com InlineKeyboard; o callback registra (upsert idempotente), edita a mensagem e envia a próxima pergunta — o "próximo" sai do banco, sem máquina de estados. Depois dos hábitos, as tarefas de projeto vencidas vão em lote (cada uma com ✅ concluí / ❌ segue). O briefing ganha bloco de hábitos (semana corrente; retrô da semana anterior às segundas; retrô do mês anterior no dia 1º) com agregação pura — a frase de motivação é do modelo forte. Projeto parado (≥10 dias sem movimento) é coletor novo da F4 (source `projects`).

**Tech Stack:** Node 22, TypeScript ESM NodeNext, grammY (`InlineKeyboard`, `callback_query:data`), Supabase PostgREST, node-cron, vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-fase7-habitos-projetos-design.md`

## Global Constraints

- Imports relativos SEMPRE terminam em `.js` (ESM NodeNext); ponto e vírgula; aspas simples; strings/comentários em PT-BR.
- Check-in das 21:00 NÃO usa LLM e NÃO passa pelo juiz/teto da F4 (rotina, como o briefing). Sem pendência = sem mensagem.
- Semana começa na SEGUNDA. "Não fiz" também é registro (`done=false`) e não repergunta no dia. Um registro por hábito/dia (`unique(habit_id, date)`, upsert).
- Callbacks idempotentes: reclique com o mesmo valor responde "já registrado" e NÃO dispara a próxima pergunta; só registro NOVO avança a sequência.
- Toda escrita em projeto (nota, status, tarefa criada/movida) toca `projects.updated_at` — é a base do "projeto parado".
- Mensagens PT-BR, datas `dd/mm`, nunca UUIDs ao usuário.
- Padrão de módulos: deps injetáveis com `defaultDeps`; try/catch por usuário nos jobs; tools com `FAIL` amigável.
- Testes: vitest da raiz (`npx vitest run <caminho>`); teste que importe (mesmo transitivamente) `db/client.ts` tem `import '../test-setup.js';` como PRIMEIRO import; fakes, nunca rede. `bot.ts` não tem teste próprio (padrão do repo) — a lógica de decisão do callback fica em função exportada testável.
- Crons existentes intocados; novos: check-in `0 21 * * *`; coletor de projetos junta no cron das tarefas (`30 6 * * *` vira `cycle(['tasks', 'projects'], 'tasks')`).
- Fora de escopo: preparação da semana, hábitos compartilhados do casal, UI web (F8), integração com git.

### Interfaces já existentes que esta fase consome (verbatim do código atual)

- `db/chats.ts`: `getChatIdentity(chatId): Promise<ChatIdentity | null>` (`ChatIdentity = { chatId; kind: 'private'|'group'; userName; subject: 'luis'|'esposa'|null }`), `getUserBySubject(subject)` → `UserRecord = { id; name; calendarId }`, `getSubjectChatId(subject)`.
- `db/events.ts`: `insertEvent({ source; kind; dedupeKey; summary; payload? })` — null se dedupe repetido; `EventSource` hoje: `'finance' | 'calendar' | 'tasks' | 'gmail'`.
- `lib/dates.ts`: `todayInTz(tz, now?)`, `addDays(isoDate, days)`.
- `bot/callback.ts` (código completo atual mostrado na Task 4): `encodeFinAction`, `decodeAction` (só `fin:ok:<txId>`).
- `bot/bot.ts`: handler `callback_query:data` com padrão try/catch + `answerCallbackQuery` + `editMessageText(...).catch(() => {})` (mostrado na Task 4).
- `jobs/finance-review.ts` (padrão a espelhar): `new InlineKeyboard().text('✅ Confirmar', encodeFinAction('ok', t.id))` e `bot.api.sendMessage(chatId, text, { reply_markup: kb })`.
- `jobs/briefing.ts`: `BriefingContext` atual tem `{ name; date; agenda; tasks; queued; commitmentsToday; finance; cleanup }`; `buildBriefingPrompt` monta `parts: string[]`; `isEmptyBriefing`; `BriefingDeps`/`defaultBriefingDeps()`; `contextFor(subject, deps)` interno.
- `proactive/engine.ts`: `CollectorSource = 'finance' | 'calendar' | 'tasks'`; `defaultEngineDeps()` monta `collectors` (`tasks: () => collectTaskEvents()`, etc.).
- `proactive/collect-tasks.ts` (padrão a espelhar): seleção PURA + deps + loop por subject com try/catch.
- `jobs/scheduler.ts`: `cycle(sources, label)`, crons existentes; `scripts/run-proactive.ts` chama `runProactiveCycle(['finance', 'calendar', 'tasks'], ...)`.
- `agent/agent.ts`: `buildTools(identity)` com spreads; `agent/prompts.ts`: const `capabilities` com bullets.

---

### Task 1: Migração 0006 + camadas de dados (`db/habits.ts`, `db/projects.ts`)

**Files:**
- Create: `supabase/migrations/0006_fase7.sql`
- Create: `apps/server/src/db/habits.ts`
- Create: `apps/server/src/db/projects.ts`
- Modify: `apps/server/src/db/events.ts` (linha do `EventSource`)

**Interfaces:**
- Consumes: `supabase` de `./client.js`.
- Produces (usadas pelas Tasks 2–6):
  - `EventSource` passa a incluir `'projects'`.
  - `db/habits.ts`: `type Habit = { id: string; name: string; targetPerWeek: number }`; `type HabitCheckin = { habitId: string; date: string; done: boolean }`; `listActiveHabits(userId)`, `getHabitById(id): Promise<Habit | null>`, `createHabit(userId, name, targetPerWeek): Promise<Habit>`, `archiveHabit(habitId)`, `getCheckin(habitId, date): Promise<{ done: boolean } | null>`, `upsertCheckin(habitId, date, done)`, `listCheckinsBetween(habitIds: string[], from: string, to: string): Promise<HabitCheckin[]>`, `pendingHabitsFor(userId, date): Promise<Habit[]>`.
  - `db/projects.ts`: `type Project = { id: string; name: string; status: string | null; updatedAt: string }`; `type ProjectTask = { id: string; projectId: string; title: string; status: 'todo' | 'doing' | 'done'; dueDate: string | null }`; `type ProjectNote = { kind: 'status' | 'decision' | 'note'; content: string; createdAt: string }`; `createProject(userId, name)`, `findProjectByName(userId, name)` (ilike, primeiro match), `listActiveProjects(userId)`, `setProjectStatus(projectId, status)`, `addProjectNote(projectId, kind, content)`, `listRecentNotes(projectId, limit?)`, `addProjectTask(projectId, title, dueDate?)`, `moveProjectTask(taskId, status)`, `listProjectTasks(projectId)`, `listOverdueProjectTasks(userId, today): Promise<Array<ProjectTask & { projectName: string }>>`, `archiveProject(projectId)`.

Nota: módulos `db/` não têm testes próprios (padrão do repo).

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/0006_fase7.sql`:

```sql
-- Fase 7: hábitos (meta semanal + check-ins) e projetos (linha do tempo + quadro)
create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  target_per_week int not null check (target_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table habit_checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  date date not null,
  done boolean not null,
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  status text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('status','decision','note')),
  content text not null,
  created_at timestamptz not null default now()
);

create table project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index habit_checkins_date_idx on habit_checkins (habit_id, date);
create index project_tasks_due_idx on project_tasks (due_date) where due_date is not null;

alter table habits enable row level security;
alter table habit_checkins enable row level security;
alter table projects enable row level security;
alter table project_notes enable row level security;
alter table project_tasks enable row level security;

-- proatividade: projeto parado entra na fila de eventos
alter table event_queue drop constraint event_queue_source_check;
alter table event_queue add constraint event_queue_source_check
  check (source in ('finance','calendar','tasks','gmail','projects'));
```

(A migração NÃO é aplicada pelo implementer — o controlador aplica em produção no pós-merge.)

- [ ] **Step 2: Implementar `apps/server/src/db/habits.ts`**

```ts
import { supabase } from './client.js';

export type Habit = { id: string; name: string; targetPerWeek: number };
export type HabitCheckin = { habitId: string; date: string; done: boolean };

const COLS = 'id, name, target_per_week';

function toHabit(r: { id: string; name: string; target_per_week: number }): Habit {
  return { id: r.id, name: r.name, targetPerWeek: r.target_per_week };
}

export async function listActiveHabits(userId: string): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select(COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toHabit);
}

export async function getHabitById(id: string): Promise<Habit | null> {
  const { data, error } = await supabase.from('habits').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toHabit(data) : null;
}

export async function createHabit(userId: string, name: string, targetPerWeek: number): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .insert({ user_id: userId, name, target_per_week: targetPerWeek })
    .select(COLS)
    .single();
  if (error) throw error;
  return toHabit(data);
}

export async function archiveHabit(habitId: string): Promise<void> {
  const { error } = await supabase.from('habits').update({ active: false }).eq('id', habitId);
  if (error) throw error;
}

export async function getCheckin(habitId: string, date: string): Promise<{ done: boolean } | null> {
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('done')
    .eq('habit_id', habitId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data ? { done: Boolean(data.done) } : null;
}

/** Um registro por hábito/dia; reclique atualiza (unique habit_id+date). */
export async function upsertCheckin(habitId: string, date: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('habit_checkins')
    .upsert({ habit_id: habitId, date, done }, { onConflict: 'habit_id,date' });
  if (error) throw error;
}

export async function listCheckinsBetween(habitIds: string[], from: string, to: string): Promise<HabitCheckin[]> {
  if (habitIds.length === 0) return [];
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('habit_id, date, done')
    .in('habit_id', habitIds)
    .gte('date', from)
    .lte('date', to);
  if (error) throw error;
  return (data ?? []).map((r) => ({ habitId: r.habit_id as string, date: r.date as string, done: Boolean(r.done) }));
}

/** Hábitos ativos SEM registro no dia (a fila do check-in das 21:00). */
export async function pendingHabitsFor(userId: string, date: string): Promise<Habit[]> {
  const habits = await listActiveHabits(userId);
  if (habits.length === 0) return [];
  const { data, error } = await supabase
    .from('habit_checkins')
    .select('habit_id')
    .eq('date', date)
    .in('habit_id', habits.map((h) => h.id));
  if (error) throw error;
  const answered = new Set((data ?? []).map((r) => r.habit_id as string));
  return habits.filter((h) => !answered.has(h.id));
}
```

- [ ] **Step 3: Implementar `apps/server/src/db/projects.ts`**

```ts
import { supabase } from './client.js';

export type Project = { id: string; name: string; status: string | null; updatedAt: string };
export type ProjectTask = {
  id: string;
  projectId: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  dueDate: string | null;
};
export type ProjectNote = { kind: 'status' | 'decision' | 'note'; content: string; createdAt: string };

const P_COLS = 'id, name, status, updated_at';
const T_COLS = 'id, project_id, title, status, due_date';

function toProject(r: { id: string; name: string; status: string | null; updated_at: string }): Project {
  return { id: r.id, name: r.name, status: r.status, updatedAt: r.updated_at };
}

function toTask(r: { id: string; project_id: string; title: string; status: string; due_date: string | null }): ProjectTask {
  return { id: r.id, projectId: r.project_id, title: r.title, status: r.status as ProjectTask['status'], dueDate: r.due_date };
}

/** Toda escrita em projeto passa por aqui: base do "projeto parado". */
async function touchProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
  if (error) throw error;
}

export async function createProject(userId: string, name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert({ user_id: userId, name }).select(P_COLS).single();
  if (error) throw error;
  return toProject(data);
}

export async function findProjectByName(userId: string, name: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select(P_COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .ilike('name', `%${name}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function listActiveProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(P_COLS)
    .eq('user_id', userId)
    .eq('active', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toProject);
}

export async function archiveProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ active: false }).eq('id', projectId);
  if (error) throw error;
}

export async function setProjectStatus(projectId: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw error;
}

export async function addProjectNote(projectId: string, kind: ProjectNote['kind'], content: string): Promise<void> {
  const { error } = await supabase.from('project_notes').insert({ project_id: projectId, kind, content });
  if (error) throw error;
  await touchProject(projectId);
}

export async function listRecentNotes(projectId: string, limit = 5): Promise<ProjectNote[]> {
  const { data, error } = await supabase
    .from('project_notes')
    .select('kind, content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ kind: r.kind as ProjectNote['kind'], content: r.content as string, createdAt: r.created_at as string }));
}

export async function addProjectTask(projectId: string, title: string, dueDate?: string): Promise<ProjectTask> {
  const { data, error } = await supabase
    .from('project_tasks')
    .insert({ project_id: projectId, title, due_date: dueDate ?? null })
    .select(T_COLS)
    .single();
  if (error) throw error;
  await touchProject(projectId);
  return toTask(data);
}

export async function moveProjectTask(taskId: string, status: ProjectTask['status']): Promise<void> {
  const { data, error } = await supabase
    .from('project_tasks')
    .update({ status, done_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', taskId)
    .select('project_id')
    .single();
  if (error) throw error;
  await touchProject(data.project_id as string);
}

export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select(T_COLS)
    .eq('project_id', projectId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTask);
}

/** Tarefas de projeto vencidas do usuário (para o check-in das 21:00). */
export async function listOverdueProjectTasks(
  userId: string,
  today: string,
): Promise<Array<ProjectTask & { projectName: string }>> {
  const { data, error } = await supabase
    .from('project_tasks')
    .select(`${T_COLS}, projects!inner(name, user_id, active)`)
    .neq('status', 'done')
    .lt('due_date', today)
    .eq('projects.user_id', userId)
    .eq('projects.active', true)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...toTask(r as never),
    projectName: (r as { projects: { name: string } }).projects.name,
  }));
}
```

- [ ] **Step 4: `EventSource` em `apps/server/src/db/events.ts`**

```ts
export type EventSource = 'finance' | 'calendar' | 'tasks' | 'gmail' | 'projects';
```

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add supabase/migrations/0006_fase7.sql apps/server/src/db/habits.ts apps/server/src/db/projects.ts apps/server/src/db/events.ts
git commit -m "feat(f7): migração 0006 + camadas de dados de hábitos e projetos"
```

---

### Task 2: Estatísticas puras de hábitos (`services/habit-stats.ts`) + tools de hábitos

**Files:**
- Create: `apps/server/src/services/habit-stats.ts`
- Create: `apps/server/src/services/habit-stats.test.ts`
- Create: `apps/server/src/tools/habits.ts`
- Create: `apps/server/src/tools/habits.test.ts`
- Modify: `apps/server/src/agent/agent.ts` (registrar `...buildHabitTools(identity),` depois de `...buildKnowledgeTools(),`)
- Modify: `apps/server/src/agent/prompts.ts` (bullet de hábitos em `capabilities`, depois do bullet do Segundo cérebro)

**Interfaces:**
- Consumes: `db/habits.ts` (Task 1); `addDays` de `../lib/dates.js`; `ChatIdentity`, `getUserBySubject`.
- Produces (usadas pelas Tasks 4 e 5):
  - `weekStart(isoDate: string): string` — segunda-feira da semana (PURA)
  - `prevWeekRange(today: string): { from: string; to: string }` — segunda a domingo anteriores (PURA)
  - `prevMonthRange(today: string): { from: string; to: string }` (PURA)
  - `type HabitProgress = { name: string; done: number; target: number }`
  - `weekProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[]` — target = meta semanal (PURA)
  - `monthProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[]` — target = `Math.round(targetPerWeek * dias / 7)` (PURA)
  - `buildHabitTools(identity: ChatIdentity, deps?: HabitToolDeps): ToolSet` — tools `habit_define`, `habit_list`, `habit_checkin`, `habit_archive`.

- [ ] **Step 1: Testes de `habit-stats` (falhando)**

`apps/server/src/services/habit-stats.test.ts` (puro — sem `test-setup`; `Habit`/`HabitCheckin` são só tipos):

```ts
import { describe, expect, it } from 'vitest';
import type { Habit, HabitCheckin } from '../db/habits.js';
import { monthProgress, prevMonthRange, prevWeekRange, weekProgress, weekStart } from './habit-stats.js';

const h = (id: string, name: string, target: number): Habit => ({ id, name, targetPerWeek: target });
const c = (habitId: string, date: string, done = true): HabitCheckin => ({ habitId, date, done });

describe('weekStart (segunda-feira)', () => {
  it.each([
    ['2026-07-16', '2026-07-13'], // quinta → segunda
    ['2026-07-13', '2026-07-13'], // segunda → ela mesma
    ['2026-07-19', '2026-07-13'], // domingo → segunda anterior
  ])('%s → %s', (d, expected) => expect(weekStart(d)).toBe(expected));
});

describe('prevWeekRange / prevMonthRange', () => {
  it('semana anterior: segunda a domingo', () => {
    expect(prevWeekRange('2026-07-16')).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });
  it('mês anterior: primeiro a último dia', () => {
    expect(prevMonthRange('2026-07-01')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(prevMonthRange('2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('weekProgress', () => {
  it('conta só done=true dentro da janela; meta = meta semanal', () => {
    const habits = [h('h1', 'Academia', 3)];
    const checkins = [
      c('h1', '2026-07-13'),
      c('h1', '2026-07-14', false), // não fez: não conta
      c('h1', '2026-07-12'), // fora da janela
    ];
    expect(weekProgress(habits, checkins, '2026-07-13', '2026-07-19')).toEqual([
      { name: 'Academia', done: 1, target: 3 },
    ]);
  });
});

describe('monthProgress', () => {
  it('meta do mês proporcional aos dias (3x/sem em junho ≈ 13)', () => {
    const habits = [h('h1', 'Academia', 3)];
    const out = monthProgress(habits, [c('h1', '2026-06-10')], '2026-06-01', '2026-06-30');
    expect(out).toEqual([{ name: 'Academia', done: 1, target: 13 }]);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/services/habit-stats.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `apps/server/src/services/habit-stats.ts`**

```ts
import type { Habit, HabitCheckin } from '../db/habits.js';
import { addDays } from '../lib/dates.js';

/** PURA: segunda-feira da semana que contém a data. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  return addDays(isoDate, -(dow === 0 ? 6 : dow - 1));
}

/** PURA: segunda a domingo da semana ANTERIOR. */
export function prevWeekRange(today: string): { from: string; to: string } {
  const ws = weekStart(today);
  return { from: addDays(ws, -7), to: addDays(ws, -1) };
}

/** PURA: primeiro a último dia do mês ANTERIOR. */
export function prevMonthRange(today: string): { from: string; to: string } {
  const firstThis = `${today.slice(0, 7)}-01`;
  const lastPrev = addDays(firstThis, -1);
  return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
}

export type HabitProgress = { name: string; done: number; target: number };

function countDone(habitId: string, checkins: HabitCheckin[], from: string, to: string): number {
  return checkins.filter((c) => c.habitId === habitId && c.done && c.date >= from && c.date <= to).length;
}

/** PURA: progresso numa janela semanal — meta = meta semanal do hábito. */
export function weekProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[] {
  return habits.map((h) => ({ name: h.name, done: countDone(h.id, checkins, from, to), target: h.targetPerWeek }));
}

/** PURA: progresso numa janela mensal — meta proporcional aos dias da janela. */
export function monthProgress(habits: Habit[], checkins: HabitCheckin[], from: string, to: string): HabitProgress[] {
  const days = Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  return habits.map((h) => ({
    name: h.name,
    done: countDone(h.id, checkins, from, to),
    target: Math.round((h.targetPerWeek * days) / 7),
  }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/services/habit-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Testes das tools (falhando)**

`apps/server/src/tools/habits.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildHabitTools, type HabitToolDeps } from './habits.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };

function deps(over: Partial<HabitToolDeps> = {}) {
  const created: Array<{ name: string; target: number }> = [];
  const checkins: Array<{ habitId: string; date: string; done: boolean }> = [];
  const d: HabitToolDeps = {
    getUserBySubject: async () => ({ id: 'u1', name: 'Luis', calendarId: null }) as never,
    listActiveHabits: async () => [{ id: 'h1', name: 'Academia', targetPerWeek: 3 }],
    createHabit: async (_u, name, target) => {
      created.push({ name, target });
      return { id: 'h9', name, targetPerWeek: target };
    },
    archiveHabit: async () => undefined,
    upsertCheckin: async (habitId, date, done) => void checkins.push({ habitId, date, done }),
    listCheckinsBetween: async () => [{ habitId: 'h1', date: '2026-07-14', done: true }],
    todayIso: () => '2026-07-16',
    ...over,
  };
  return { d, created, checkins };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  const t = toolset[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('habit_define', () => {
  it('cria hábito com meta semanal', async () => {
    const { d, created } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_define', { name: 'Leitura', target_per_week: 5 });
    expect(created).toEqual([{ name: 'Leitura', target: 5 }]);
    expect(out).toContain('Leitura');
  });
});

describe('habit_list', () => {
  it('lista com progresso da semana corrente', async () => {
    const { d } = deps();
    const out = JSON.parse(await run(buildHabitTools(luis, d) as never, 'habit_list', {}));
    expect(out[0]).toEqual({ id: 'h1', habito: 'Academia', semana: '1/3' });
  });
});

describe('habit_checkin', () => {
  it('registra pelo nome (match case-insensitive), hoje por padrão', async () => {
    const { d, checkins } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_checkin', { habit_name: 'academia', done: true });
    expect(checkins).toEqual([{ habitId: 'h1', date: '2026-07-16', done: true }]);
    expect(out).toContain('Academia');
  });
  it('hábito desconhecido avisa sem quebrar', async () => {
    const { d, checkins } = deps();
    const out = await run(buildHabitTools(luis, d) as never, 'habit_checkin', { habit_name: 'yoga', done: true });
    expect(checkins).toEqual([]);
    expect(out).toContain('não achei');
  });
});

describe('sem subject (grupo sem dono)', () => {
  it('pede para especificar a pessoa', async () => {
    const grupo: ChatIdentity = { chatId: 3, kind: 'group', userName: null, subject: null };
    const { d } = deps();
    const out = await run(buildHabitTools(grupo, d) as never, 'habit_list', {});
    expect(out).toContain('de quem');
  });
});
```

- [ ] **Step 6: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/tools/habits.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar `apps/server/src/tools/habits.ts`**

```ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUserBySubject, type ChatIdentity } from '../db/chats.js';
import {
  archiveHabit,
  createHabit,
  listActiveHabits,
  listCheckinsBetween,
  upsertCheckin,
} from '../db/habits.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { weekProgress, weekStart } from '../services/habit-stats.js';

export type HabitToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  listActiveHabits: typeof listActiveHabits;
  createHabit: typeof createHabit;
  archiveHabit: typeof archiveHabit;
  upsertCheckin: typeof upsertCheckin;
  listCheckinsBetween: typeof listCheckinsBetween;
  todayIso: () => string;
};

const defaultDeps: HabitToolDeps = {
  getUserBySubject,
  listActiveHabits,
  createHabit,
  archiveHabit,
  upsertCheckin,
  listCheckinsBetween,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

const FAIL = 'Não consegui acessar os hábitos agora. Tenta de novo em instantes.';
const SEM_DONO = 'Hábitos são individuais — de quem é? (Luis ou esposa)';

async function userIdFor(identity: ChatIdentity, deps: HabitToolDeps): Promise<string | null> {
  if (!identity.subject) return null;
  return (await deps.getUserBySubject(identity.subject))?.id ?? null;
}

export function buildHabitTools(identity: ChatIdentity, deps: HabitToolDeps = defaultDeps): ToolSet {
  return {
    habit_define: tool({
      description: 'Cria um hábito com meta semanal para acompanhar (ex.: academia 3x por semana).',
      inputSchema: z.object({
        name: z.string().min(2),
        target_per_week: z.number().int().min(1).max(7),
      }),
      execute: async ({ name, target_per_week }) => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const h = await deps.createHabit(userId, name, target_per_week);
          return `Hábito "${h.name}" criado — meta ${h.targetPerWeek}x por semana. Check-in todo dia às 21h.`;
        } catch {
          return FAIL;
        }
      },
    }),
    habit_list: tool({
      description: 'Lista os hábitos da pessoa com o progresso da semana corrente.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const habits = await deps.listActiveHabits(userId);
          if (habits.length === 0) return 'Nenhum hábito cadastrado ainda.';
          const today = deps.todayIso();
          const from = weekStart(today);
          const checkins = await deps.listCheckinsBetween(habits.map((h) => h.id), from, today);
          const progress = weekProgress(habits, checkins, from, today);
          return JSON.stringify(
            habits.map((h, i) => ({ id: h.id, habito: h.name, semana: `${progress[i].done}/${progress[i].target}` })),
          );
        } catch {
          return FAIL;
        }
      },
    }),
    habit_checkin: tool({
      description:
        'Registra o hábito de um dia por conversa ("fui na academia", "hoje não li"). done=false também é registro.',
      inputSchema: z.object({
        habit_name: z.string(),
        done: z.boolean(),
        date: z.string().optional().describe('YYYY-MM-DD; padrão hoje'),
      }),
      execute: async ({ habit_name, done, date }) => {
        try {
          const userId = await userIdFor(identity, deps);
          if (!userId) return SEM_DONO;
          const habits = await deps.listActiveHabits(userId);
          const habit = habits.find((h) => h.name.toLowerCase().includes(habit_name.toLowerCase()));
          if (!habit) return `Não achei o hábito "${habit_name}". Os ativos: ${habits.map((h) => h.name).join(', ') || 'nenhum'}.`;
          await deps.upsertCheckin(habit.id, date ?? deps.todayIso(), done);
          return `${done ? '✅' : '❌'} ${habit.name} registrado.`;
        } catch {
          return FAIL;
        }
      },
    }),
    habit_archive: tool({
      description: 'Arquiva (desativa) um hábito — use o id retornado por habit_list.',
      inputSchema: z.object({ habit_id: z.string() }),
      execute: async ({ habit_id }) => {
        try {
          await deps.archiveHabit(habit_id);
          return 'Hábito arquivado.';
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
```

Em `apps/server/src/agent/agent.ts`: adicionar `import { buildHabitTools } from '../tools/habits.js';` e, em `buildTools`, `...buildHabitTools(identity),` logo depois de `...buildKnowledgeTools(),`.

Em `apps/server/src/agent/prompts.ts`, adicionar o bullet em `capabilities` logo após o do Segundo cérebro (mesma indentação):

```
- Hábitos: individuais, com meta semanal (tools habit_define, habit_list, habit_checkin, habit_archive). Check-in automático às 21h com botões; a pessoa também registra por conversa ("fui na academia" → habit_checkin done=true; "hoje não deu" → done=false).
```

- [ ] **Step 8: Rodar e ver passar (novos + agente)**

Run: `npx vitest run apps/server/src/tools/habits.test.ts apps/server/src/services/habit-stats.test.ts apps/server/src/agent`
Expected: PASS.

- [ ] **Step 9: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/services/habit-stats.ts apps/server/src/services/habit-stats.test.ts apps/server/src/tools/habits.ts apps/server/src/tools/habits.test.ts apps/server/src/agent/agent.ts apps/server/src/agent/prompts.ts
git commit -m "feat(f7): estatísticas puras de hábitos + tools de hábitos no agente"
```

---

### Task 3: Tools de projetos (`tools/projects.ts`)

**Files:**
- Create: `apps/server/src/tools/projects.ts`
- Create: `apps/server/src/tools/projects.test.ts`
- Modify: `apps/server/src/agent/agent.ts` (registrar `...buildProjectTools(identity),` depois de `...buildHabitTools(identity),`)
- Modify: `apps/server/src/agent/prompts.ts` (bullet de projetos depois do de hábitos)

**Interfaces:**
- Consumes: `db/projects.ts` (Task 1); `getUserBySubject`, `ChatIdentity`.
- Produces: `buildProjectTools(identity, deps?): ToolSet` — tools `project_create`, `project_note`, `project_set_status`, `project_overview`, `project_task_add`, `project_task_move`, `project_task_list`, `project_archive`.

**Comportamento:** todas resolvem o projeto por NOME (`findProjectByName`, ilike) — nunca pedem UUID ao usuário; projeto não achado responde sugerindo `project_create`. `project_note` recebe `kind` (`decision`/`note`); `project_set_status` grava o status curto E registra nota `kind='status'`. `project_overview` devolve JSON `{ projeto, status, notas: [{ kind, content, quando dd/mm }], tarefas: { todo: [], doing: [], done: [] } }` (done limitado às 5 últimas). `project_task_move` recebe `task_id` (dos ids retornados por `project_task_list`/`project_overview`) e `status`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/tools/projects.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../db/chats.js';
import { buildProjectTools, type ProjectToolDeps } from './projects.js';

const luis: ChatIdentity = { chatId: 1, kind: 'private', userName: 'Luis', subject: 'luis' };
const proj = { id: 'p1', name: 'Site', status: 'em andamento', updatedAt: '2026-07-10T00:00:00Z' };

function deps(over: Partial<ProjectToolDeps> = {}) {
  const notes: Array<{ kind: string; content: string }> = [];
  const moved: Array<{ taskId: string; status: string }> = [];
  const d: ProjectToolDeps = {
    getUserBySubject: async () => ({ id: 'u1', name: 'Luis', calendarId: null }) as never,
    createProject: async (_u, name) => ({ ...proj, id: 'p9', name }),
    findProjectByName: async (_u, name) => (name.toLowerCase().includes('site') ? proj : null),
    listActiveProjects: async () => [proj],
    setProjectStatus: async () => undefined,
    addProjectNote: async (_p, kind, content) => void notes.push({ kind, content }),
    listRecentNotes: async () => [{ kind: 'decision', content: 'usar Astro', createdAt: '2026-07-10T12:00:00Z' }],
    addProjectTask: async (_p, title, dueDate) => ({ id: 't1', projectId: 'p1', title, status: 'todo', dueDate: dueDate ?? null }),
    moveProjectTask: async (taskId, status) => void moved.push({ taskId, status }),
    listProjectTasks: async () => [
      { id: 't1', projectId: 'p1', title: 'wireframe', status: 'doing', dueDate: '2026-07-18' },
    ],
    archiveProject: async () => undefined,
    ...over,
  };
  return { d, notes, moved };
}

async function run(toolset: Record<string, { execute?: unknown }>, name: string, input: unknown): Promise<string> {
  const t = toolset[name] as { execute: (i: unknown, o: unknown) => Promise<string> };
  return t.execute(input, {});
}

describe('project_note', () => {
  it('registra decisão na linha do tempo do projeto achado por nome', async () => {
    const { d, notes } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_note', {
      project_name: 'site',
      kind: 'decision',
      content: 'usar Astro',
    });
    expect(notes).toEqual([{ kind: 'decision', content: 'usar Astro' }]);
    expect(out).toContain('Site');
  });
  it('projeto não achado sugere criar', async () => {
    const { d } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_note', {
      project_name: 'loja',
      kind: 'note',
      content: 'x',
    });
    expect(out).toContain('não achei');
  });
});

describe('project_set_status', () => {
  it('grava status e nota kind=status', async () => {
    const { d, notes } = deps();
    await run(buildProjectTools(luis, d) as never, 'project_set_status', {
      project_name: 'Site',
      status: 'aguardando cliente',
    });
    expect(notes).toEqual([{ kind: 'status', content: 'aguardando cliente' }]);
  });
});

describe('project_overview', () => {
  it('devolve status, notas com dd/mm e quadro por coluna', async () => {
    const { d } = deps();
    const out = JSON.parse(await run(buildProjectTools(luis, d) as never, 'project_overview', { project_name: 'Site' }));
    expect(out.projeto).toBe('Site');
    expect(out.status).toBe('em andamento');
    expect(out.notas[0]).toEqual({ kind: 'decision', content: 'usar Astro', quando: '10/07' });
    expect(out.tarefas.doing).toEqual([{ id: 't1', titulo: 'wireframe', prazo: '18/07' }]);
    expect(out.tarefas.todo).toEqual([]);
  });
});

describe('project_task_add / move', () => {
  it('cria tarefa com prazo e move por id', async () => {
    const { d, moved } = deps();
    const out = await run(buildProjectTools(luis, d) as never, 'project_task_add', {
      project_name: 'Site',
      title: 'enviar proposta',
      due_date: '2026-07-18',
    });
    expect(out).toContain('enviar proposta');
    await run(buildProjectTools(luis, d) as never, 'project_task_move', { task_id: 't1', status: 'done' });
    expect(moved).toEqual([{ taskId: 't1', status: 'done' }]);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/tools/projects.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `apps/server/src/tools/projects.ts`**

```ts
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getUserBySubject, type ChatIdentity } from '../db/chats.js';
import {
  addProjectNote,
  addProjectTask,
  archiveProject,
  createProject,
  findProjectByName,
  listActiveProjects,
  listProjectTasks,
  listRecentNotes,
  moveProjectTask,
  setProjectStatus,
  type Project,
  type ProjectTask,
} from '../db/projects.js';

export type ProjectToolDeps = {
  getUserBySubject: typeof getUserBySubject;
  createProject: typeof createProject;
  findProjectByName: typeof findProjectByName;
  listActiveProjects: typeof listActiveProjects;
  setProjectStatus: typeof setProjectStatus;
  addProjectNote: typeof addProjectNote;
  listRecentNotes: typeof listRecentNotes;
  addProjectTask: typeof addProjectTask;
  moveProjectTask: typeof moveProjectTask;
  listProjectTasks: typeof listProjectTasks;
  archiveProject: typeof archiveProject;
};

const defaultDeps: ProjectToolDeps = {
  getUserBySubject,
  createProject,
  findProjectByName,
  listActiveProjects,
  setProjectStatus,
  addProjectNote,
  listRecentNotes,
  addProjectTask,
  moveProjectTask,
  listProjectTasks,
  archiveProject,
};

const FAIL = 'Não consegui acessar os projetos agora. Tenta de novo em instantes.';
const SEM_DONO = 'Projetos têm dono — de quem é? (Luis ou esposa)';

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function taskLine(t: ProjectTask): { id: string; titulo: string; prazo: string | null } {
  return { id: t.id, titulo: t.title, prazo: t.dueDate ? ddmm(t.dueDate) : null };
}

async function resolveProject(
  identity: ChatIdentity,
  name: string,
  deps: ProjectToolDeps,
): Promise<Project | 'sem-dono' | null> {
  if (!identity.subject) return 'sem-dono';
  const user = await deps.getUserBySubject(identity.subject);
  if (!user) return 'sem-dono';
  return deps.findProjectByName(user.id, name);
}

const NAO_ACHEI = (name: string) => `Não achei o projeto "${name}". Crie com project_create se for novo.`;

export function buildProjectTools(identity: ChatIdentity, deps: ProjectToolDeps = defaultDeps): ToolSet {
  return {
    project_create: tool({
      description: 'Cria um projeto para acompanhar por conversa (status, decisões, tarefas).',
      inputSchema: z.object({ name: z.string().min(2) }),
      execute: async ({ name }) => {
        try {
          if (!identity.subject) return SEM_DONO;
          const user = await deps.getUserBySubject(identity.subject);
          if (!user) return SEM_DONO;
          const p = await deps.createProject(user.id, name);
          return `Projeto "${p.name}" criado.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_note: tool({
      description:
        'Registra uma decisão ou anotação na linha do tempo de um projeto ("no projeto X decidi Y" → kind decision).',
      inputSchema: z.object({
        project_name: z.string(),
        kind: z.enum(['decision', 'note']),
        content: z.string().min(2),
      }),
      execute: async ({ project_name, kind, content }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.addProjectNote(p.id, kind, content);
          return `Registrado no projeto ${p.name}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_set_status: tool({
      description: 'Atualiza o status curto do projeto ("status do X: aguardando cliente").',
      inputSchema: z.object({ project_name: z.string(), status: z.string().min(2) }),
      execute: async ({ project_name, status }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.setProjectStatus(p.id, status);
          await deps.addProjectNote(p.id, 'status', status);
          return `Status do ${p.name}: ${status}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_overview: tool({
      description: 'Como está um projeto: status atual, últimas notas/decisões e o quadro de tarefas.',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const [notes, tasks] = await Promise.all([deps.listRecentNotes(p.id), deps.listProjectTasks(p.id)]);
          return JSON.stringify({
            projeto: p.name,
            status: p.status,
            notas: notes.map((n) => ({ kind: n.kind, content: n.content, quando: ddmm(n.createdAt) })),
            tarefas: {
              todo: tasks.filter((t) => t.status === 'todo').map(taskLine),
              doing: tasks.filter((t) => t.status === 'doing').map(taskLine),
              done: tasks.filter((t) => t.status === 'done').slice(-5).map(taskLine),
            },
          });
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_add: tool({
      description: 'Adiciona uma tarefa ao quadro do projeto (coluna to do), com prazo opcional.',
      inputSchema: z.object({
        project_name: z.string(),
        title: z.string().min(2),
        due_date: z.string().optional().describe('YYYY-MM-DD'),
      }),
      execute: async ({ project_name, title, due_date }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const t = await deps.addProjectTask(p.id, title, due_date);
          return `Tarefa "${t.title}" no ${p.name}${t.dueDate ? ` (prazo ${ddmm(t.dueDate)})` : ''}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_move: tool({
      description: 'Move uma tarefa do quadro (todo/doing/done) — use o id de project_overview/project_task_list.',
      inputSchema: z.object({ task_id: z.string(), status: z.enum(['todo', 'doing', 'done']) }),
      execute: async ({ task_id, status }) => {
        try {
          await deps.moveProjectTask(task_id, status);
          return `Tarefa movida para ${status}.`;
        } catch {
          return FAIL;
        }
      },
    }),
    project_task_list: tool({
      description: 'Lista as tarefas do quadro de um projeto.',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          const tasks = await deps.listProjectTasks(p.id);
          if (tasks.length === 0) return `Quadro do ${p.name} vazio.`;
          return JSON.stringify(tasks.map((t) => ({ ...taskLine(t), coluna: t.status })));
        } catch {
          return FAIL;
        }
      },
    }),
    project_archive: tool({
      description: 'Arquiva um projeto encerrado (some das listas e da cobrança).',
      inputSchema: z.object({ project_name: z.string() }),
      execute: async ({ project_name }) => {
        try {
          const p = await resolveProject(identity, project_name, deps);
          if (p === 'sem-dono') return SEM_DONO;
          if (!p) return NAO_ACHEI(project_name);
          await deps.archiveProject(p.id);
          return `Projeto ${p.name} arquivado.`;
        } catch {
          return FAIL;
        }
      },
    }),
  };
}
```

Em `apps/server/src/agent/agent.ts`: adicionar `import { buildProjectTools } from '../tools/projects.js';` e `...buildProjectTools(identity),` logo depois de `...buildHabitTools(identity),`.

Em `apps/server/src/agent/prompts.ts`, bullet depois do de Hábitos:

```
- Projetos: registro por conversa (tools project_create, project_note, project_set_status, project_overview, project_task_add, project_task_move, project_task_list, project_archive). "No projeto X decidi Y" → project_note kind=decision; "status do X: ..." → project_set_status; quadro to do/doing/done com prazos. Projetos são referidos por NOME, nunca por id.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/tools/projects.test.ts apps/server/src/agent`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/tools/projects.ts apps/server/src/tools/projects.test.ts apps/server/src/agent/agent.ts apps/server/src/agent/prompts.ts
git commit -m "feat(f7): tools de projetos (linha do tempo, status, quadro) no agente"
```

---

### Task 4: Check-in das 21:00 (`jobs/daily-checkin.ts`) + callbacks no bot

**Files:**
- Modify: `apps/server/src/bot/callback.ts` (união de ações)
- Modify: `apps/server/src/bot/callback.test.ts` (casos novos)
- Create: `apps/server/src/jobs/daily-checkin.ts`
- Create: `apps/server/src/jobs/daily-checkin.test.ts`
- Modify: `apps/server/src/bot/bot.ts` (despacho por kind no handler de callback)

**Interfaces:**
- Consumes: `db/habits.ts`, `db/projects.ts` (Task 1); `getChatIdentity`, `getUserBySubject`, `getSubjectChatId`; `InlineKeyboard` do grammY.
- Produces (usada pela Task 7):
  - Em `callback.ts`: `type BotAction = { kind: 'fin'; action: 'ok'; txId: string } | { kind: 'hab'; done: boolean; habitId: string } | { kind: 'ptask'; action: 'done' | 'keep'; taskId: string }`; `encodeHabitAction(done, habitId)`, `encodePtaskAction(action, taskId)`; `decodeAction(data): BotAction | null`.
  - Em `daily-checkin.ts`: `type SendWithKb = (chatId: number, text: string, kb?: import('grammy').InlineKeyboard) => Promise<void>`; `runDailyCheckin(send: SendWithKb, deps?: CheckinDeps): Promise<void>`; `sendNextCheckinQuestion(userId: string, chatId: number, send: SendWithKb, deps?: CheckinDeps): Promise<void>`; `registerHabitAnswer(habitId: string, done: boolean, date: string, deps?: CheckinDeps): Promise<'novo' | 'repetido' | 'alterado'>`.

**Comportamento (verbatim da spec):**
- `runDailyCheckin`: para cada subject (`luis`, `esposa`, try/catch por pessoa): resolve user+chatId; `sendNextCheckinQuestion`. Sem pendência nenhuma (nem hábito, nem tarefa vencida) = silêncio.
- `sendNextCheckinQuestion`: hábitos pendentes do dia → envia SÓ a primeira pergunta (`"<nome> hoje?"` com ✅ `hab:sim:<id>` / ❌ `hab:nao:<id>`). Se NÃO há hábito pendente → envia o LOTE de tarefas de projeto vencidas (cap 5): `Tarefa vencida no projeto <nome>: "<título>" (prazo dd/mm)` com ✅ Concluí (`ptask:done:<id>`) / ❌ Segue pendente (`ptask:keep:<id>`).
- `registerHabitAnswer`: lê `getCheckin`; igual ao clicado → `'repetido'` (NÃO grava, NÃO avança); diferente → grava e retorna `'alterado'` (NÃO avança); inexistente → grava e retorna `'novo'` (avança: o chamador dispara `sendNextCheckinQuestion`).
- Handler no `bot.ts`: `hab` → `registerHabitAnswer` + edita a mensagem (`✅ <nome> — feito hoje` / `❌ <nome> — hoje não`) + se `'novo'`, `sendNextCheckinQuestion`; `ptask done` → `moveProjectTask(taskId, 'done')` + edita (`✅ <primeira linha da mensagem>`); `ptask keep` → só edita (`⏳ ...`). Sem LLM em nada disso.

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/bot/callback.test.ts`, adicionar (mantendo os casos existentes de `fin`):

```ts
import { encodeHabitAction, encodePtaskAction } from './callback.js';

describe('callbacks de hábito e tarefa de projeto', () => {
  it('hab codifica e decodifica', () => {
    expect(decodeAction(encodeHabitAction(true, 'h1'))).toEqual({ kind: 'hab', done: true, habitId: 'h1' });
    expect(decodeAction(encodeHabitAction(false, 'h1'))).toEqual({ kind: 'hab', done: false, habitId: 'h1' });
  });
  it('ptask codifica e decodifica', () => {
    expect(decodeAction(encodePtaskAction('done', 't1'))).toEqual({ kind: 'ptask', action: 'done', taskId: 't1' });
    expect(decodeAction(encodePtaskAction('keep', 't1'))).toEqual({ kind: 'ptask', action: 'keep', taskId: 't1' });
  });
  it('dados desconhecidos continuam null', () => {
    expect(decodeAction('hab:talvez:h1')).toBeNull();
    expect(decodeAction('ptask:zzz:t1')).toBeNull();
  });
});
```

(Ajuste os imports do arquivo conforme necessário — `decodeAction` já é importado.)

`apps/server/src/jobs/daily-checkin.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import {
  registerHabitAnswer,
  runDailyCheckin,
  sendNextCheckinQuestion,
  type CheckinDeps,
} from './daily-checkin.js';

type Sent = Array<{ chatId: number; text: string; kb: boolean }>;

function deps(over: Partial<CheckinDeps> = {}) {
  const upserts: Array<{ habitId: string; date: string; done: boolean }> = [];
  const d: CheckinDeps = {
    getUserBySubject: async (s) => (s === 'luis' ? ({ id: 'u1', name: 'Luis', calendarId: null } as never) : null),
    getSubjectChatId: async (s) => (s === 'luis' ? 111 : null),
    pendingHabitsFor: async () => [{ id: 'h1', name: 'Academia', targetPerWeek: 3 }],
    getCheckin: async () => null,
    upsertCheckin: async (habitId, date, done) => void upserts.push({ habitId, date, done }),
    listOverdueProjectTasks: async () => [],
    todayIso: () => '2026-07-16',
    ...over,
  };
  return { d, upserts };
}

function collector(): { send: (chatId: number, text: string, kb?: unknown) => Promise<void>; sent: Sent } {
  const sent: Sent = [];
  return { sent, send: async (chatId, text, kb) => void sent.push({ chatId, text, kb: kb !== undefined }) };
}

describe('runDailyCheckin', () => {
  it('manda SÓ a primeira pergunta de hábito pendente, com botões', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [
        { id: 'h1', name: 'Academia', targetPerWeek: 3 },
        { id: 'h2', name: 'Leitura', targetPerWeek: 5 },
      ],
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: 111, kb: true });
    expect(sent[0].text).toContain('Academia');
  });

  it('sem pendência nenhuma = silêncio', async () => {
    const { d } = deps({ pendingHabitsFor: async () => [] });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(0);
  });

  it('sem hábito pendente mas com tarefas vencidas: manda o lote (cap 5)', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [],
      listOverdueProjectTasks: async () =>
        Array.from({ length: 7 }, (_, i) => ({
          id: `t${i}`,
          projectId: 'p1',
          title: `tarefa ${i}`,
          status: 'todo' as const,
          dueDate: '2026-07-10',
          projectName: 'Site',
        })),
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(5);
    expect(sent[0].text).toContain('Site');
    expect(sent[0].text).toContain('10/07');
    expect(sent.every((s) => s.kb)).toBe(true);
  });

  it('falha de um usuário não derruba o outro', async () => {
    const { d } = deps({
      getUserBySubject: async (s) => {
        if (s === 'luis') throw new Error('boom');
        return { id: 'u2', name: 'Esposa', calendarId: null } as never;
      },
      getSubjectChatId: async () => 222,
    });
    const { send, sent } = collector();
    await runDailyCheckin(send, d);
    expect(sent).toHaveLength(1); // só a esposa recebeu
    expect(sent[0].chatId).toBe(222);
  });
});

describe('registerHabitAnswer (idempotência)', () => {
  it('novo registra e retorna novo', async () => {
    const { d, upserts } = deps();
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('novo');
    expect(upserts).toEqual([{ habitId: 'h1', date: '2026-07-16', done: true }]);
  });
  it('reclique com o mesmo valor não grava e retorna repetido', async () => {
    const { d, upserts } = deps({ getCheckin: async () => ({ done: true }) });
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('repetido');
    expect(upserts).toEqual([]);
  });
  it('mudança de valor grava e retorna alterado (não avança)', async () => {
    const { d, upserts } = deps({ getCheckin: async () => ({ done: false }) });
    expect(await registerHabitAnswer('h1', true, '2026-07-16', d)).toBe('alterado');
    expect(upserts).toHaveLength(1);
  });
});

describe('sendNextCheckinQuestion', () => {
  it('com hábito pendente pergunta o hábito; sem, cai nas tarefas vencidas', async () => {
    const { d } = deps({
      pendingHabitsFor: async () => [],
      listOverdueProjectTasks: async () => [
        { id: 't1', projectId: 'p1', title: 'proposta', status: 'todo' as const, dueDate: '2026-07-10', projectName: 'Site' },
      ],
    });
    const { send, sent } = collector();
    await sendNextCheckinQuestion('u1', 111, send, d);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('proposta');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/bot/callback.test.ts apps/server/src/jobs/daily-checkin.test.ts`
Expected: FAIL — encode novos e módulo daily-checkin não existem.

- [ ] **Step 3: Implementar**

`apps/server/src/bot/callback.ts` (arquivo inteiro vira):

```ts
export type FinCallbackAction = 'ok';

export type BotAction =
  | { kind: 'fin'; action: FinCallbackAction; txId: string }
  | { kind: 'hab'; done: boolean; habitId: string }
  | { kind: 'ptask'; action: 'done' | 'keep'; taskId: string };

export function encodeFinAction(action: FinCallbackAction, txId: string): string {
  return `fin:${action}:${txId}`;
}

export function encodeHabitAction(done: boolean, habitId: string): string {
  return `hab:${done ? 'sim' : 'nao'}:${habitId}`;
}

export function encodePtaskAction(action: 'done' | 'keep', taskId: string): string {
  return `ptask:${action}:${taskId}`;
}

export function decodeAction(data: string): BotAction | null {
  const [kind, action, id] = data.split(':');
  if (!id) return null;
  if (kind === 'fin' && action === 'ok') return { kind: 'fin', action, txId: id };
  if (kind === 'hab' && (action === 'sim' || action === 'nao')) return { kind: 'hab', done: action === 'sim', habitId: id };
  if (kind === 'ptask' && (action === 'done' || action === 'keep')) return { kind: 'ptask', action, taskId: id };
  return null;
}
```

`apps/server/src/jobs/daily-checkin.ts`:

```ts
import { InlineKeyboard } from 'grammy';
import { encodeHabitAction, encodePtaskAction } from '../bot/callback.js';
import { getSubjectChatId, getUserBySubject } from '../db/chats.js';
import { getCheckin, pendingHabitsFor, upsertCheckin } from '../db/habits.js';
import { listOverdueProjectTasks } from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';

const MAX_PTASKS = 5;

export type SendWithKb = (chatId: number, text: string, kb?: InlineKeyboard) => Promise<void>;

export type CheckinDeps = {
  getUserBySubject: typeof getUserBySubject;
  getSubjectChatId: typeof getSubjectChatId;
  pendingHabitsFor: typeof pendingHabitsFor;
  getCheckin: typeof getCheckin;
  upsertCheckin: typeof upsertCheckin;
  listOverdueProjectTasks: typeof listOverdueProjectTasks;
  todayIso: () => string;
};

const defaultDeps: CheckinDeps = {
  getUserBySubject,
  getSubjectChatId,
  pendingHabitsFor,
  getCheckin,
  upsertCheckin,
  listOverdueProjectTasks,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

/** Registra a resposta do botão com idempotência:
 *  'novo' = primeiro registro do dia (avança a fila); 'repetido' = reclique igual (não grava);
 *  'alterado' = mudou de ideia (grava, não avança — a fila já andou na primeira vez). */
export async function registerHabitAnswer(
  habitId: string,
  done: boolean,
  date: string,
  deps: CheckinDeps = defaultDeps,
): Promise<'novo' | 'repetido' | 'alterado'> {
  const existing = await deps.getCheckin(habitId, date);
  if (existing && existing.done === done) return 'repetido';
  await deps.upsertCheckin(habitId, date, done);
  return existing ? 'alterado' : 'novo';
}

/** Próxima pergunta do check-in: primeiro hábito pendente do dia; sem hábito
 *  pendente, o lote de tarefas de projeto vencidas (cap 5). Nada pendente = silêncio. */
export async function sendNextCheckinQuestion(
  userId: string,
  chatId: number,
  send: SendWithKb,
  deps: CheckinDeps = defaultDeps,
): Promise<void> {
  const today = deps.todayIso();
  const pending = await deps.pendingHabitsFor(userId, today);
  if (pending.length > 0) {
    const h = pending[0];
    const kb = new InlineKeyboard().text('✅', encodeHabitAction(true, h.id)).text('❌', encodeHabitAction(false, h.id));
    await send(chatId, `${h.name} hoje?`, kb);
    return;
  }
  const overdue = (await deps.listOverdueProjectTasks(userId, today)).slice(0, MAX_PTASKS);
  for (const t of overdue) {
    const kb = new InlineKeyboard()
      .text('✅ Concluí', encodePtaskAction('done', t.id))
      .text('❌ Segue pendente', encodePtaskAction('keep', t.id));
    await send(chatId, `Tarefa vencida no projeto ${t.projectName}: "${t.title}" (prazo ${ddmm(t.dueDate!)})`, kb);
  }
}

/** Check-in das 21:00 — rotina direta (sem juiz, fora do teto da F4), por pessoa no privado. */
export async function runDailyCheckin(send: SendWithKb, deps: CheckinDeps = defaultDeps): Promise<void> {
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      const chatId = await deps.getSubjectChatId(subject);
      if (chatId === null) continue;
      await sendNextCheckinQuestion(user.id, chatId, send, deps);
    } catch (err) {
      console.error(`[checkin] falhou para ${subject}:`, err);
    }
  }
}
```

Em `apps/server/src/bot/bot.ts`, substituir o handler de `callback_query:data` por (mantendo imports existentes e adicionando os novos):

```ts
import { Bot, InlineKeyboard } from 'grammy';
import { confirmTransaction, getTransactionById, learnRule } from '../db/finance.js';
import { getChatIdentity, getUserBySubject } from '../db/chats.js';
import { getHabitById } from '../db/habits.js';
import { moveProjectTask } from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { registerHabitAnswer, sendNextCheckinQuestion } from '../jobs/daily-checkin.js';
import { decodeAction } from './callback.js';
```

```ts
  bot.on('callback_query:data', async (ctx) => {
    try {
      const action = decodeAction(ctx.callbackQuery.data);
      if (!action) return void (await ctx.answerCallbackQuery());

      if (action.kind === 'fin') {
        const ok = await confirmTransaction(action.txId);
        await ctx.answerCallbackQuery({ text: ok ? 'Confirmado ✅' : 'Não encontrada' });
        if (!ok) return;
        await ctx
          .editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Gasto confirmado'}`)
          .catch(() => {});
        try {
          const tx = await getTransactionById(action.txId);
          if (tx?.category_id) await learnRule(tx.description, tx.category_id);
        } catch (err) {
          console.error('[bot] fin confirm: learnRule falhou:', err);
        }
        return;
      }

      if (action.kind === 'hab') {
        const chatId = ctx.chat?.id;
        const identity = chatId !== undefined ? await getChatIdentity(chatId) : null;
        if (!identity?.subject || chatId === undefined) return void (await ctx.answerCallbackQuery());
        const today = todayInTz(getConfig().TIMEZONE);
        const result = await registerHabitAnswer(action.habitId, action.done, today);
        await ctx.answerCallbackQuery({ text: result === 'repetido' ? 'Já registrado' : action.done ? 'Feito ✅' : 'Anotado' });
        if (result === 'repetido') return;
        const habit = await getHabitById(action.habitId);
        await ctx
          .editMessageText(`${action.done ? '✅' : '❌'} ${habit?.name ?? 'Hábito'} — ${action.done ? 'feito hoje' : 'hoje não'}`)
          .catch(() => {});
        if (result === 'novo') {
          const user = await getUserBySubject(identity.subject);
          if (user)
            await sendNextCheckinQuestion(user.id, chatId, (cid, text, kb) =>
              bot.api.sendMessage(cid, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
            );
        }
        return;
      }

      // ptask: tarefa de projeto vencida do check-in
      if (action.action === 'done') {
        await moveProjectTask(action.taskId, 'done');
        await ctx.answerCallbackQuery({ text: 'Concluída ✅' });
        await ctx
          .editMessageText(`✅ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Tarefa concluída'}`)
          .catch(() => {});
      } else {
        await ctx.answerCallbackQuery({ text: 'Ok, segue pendente' });
        await ctx
          .editMessageText(`⏳ ${ctx.callbackQuery.message?.text?.split('\n')[0] ?? 'Tarefa'} — segue pendente`)
          .catch(() => {});
      }
    } catch (err) {
      console.error('[bot:callback]', err);
      await ctx.answerCallbackQuery({ text: '❌ Erro, tenta de novo.' }).catch(() => {});
    }
  });
```

(O import de `InlineKeyboard` em bot.ts só é necessário se o TypeScript reclamar do tipo do parâmetro `kb` — o closure usa o tipo de `SendWithKb`; remova se ficar sem uso.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/server/src/bot/callback.test.ts apps/server/src/jobs/daily-checkin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/bot apps/server/src/jobs/daily-checkin.ts apps/server/src/jobs/daily-checkin.test.ts
git commit -m "feat(f7): check-in das 21:00 com botões (hábitos um a um + tarefas vencidas em lote)"
```

---

### Task 5: Bloco de hábitos no briefing (`jobs/briefing.ts`)

**Files:**
- Modify: `apps/server/src/jobs/briefing.ts`
- Modify: `apps/server/src/jobs/briefing.test.ts`

**Interfaces:**
- Consumes: `listActiveHabits`, `listCheckinsBetween` (Task 1); `weekStart`, `prevWeekRange`, `prevMonthRange`, `weekProgress`, `monthProgress`, `type HabitProgress` (Task 2).
- Produces: `BriefingContext` ganha `habits: { week: HabitProgress[]; lastWeek: HabitProgress[] | null; lastMonth: HabitProgress[] | null } | null`; `BriefingDeps` ganha `listActiveHabits: typeof listActiveHabits` e `listHabitCheckins: typeof listCheckinsBetween`.

**Comportamento:**
- `contextFor` (para os DOIS subjects): carrega hábitos ativos; sem hábitos → `habits: null`. Com hábitos: `week` = progresso de `weekStart(today)`..`today`; `lastWeek` = só se hoje é SEGUNDA (`weekStart(today) === today`), janela `prevWeekRange(today)`; `lastMonth` = só se `today` termina em `-01`, janela `prevMonthRange(today)`. Uma única chamada `listHabitCheckins` cobrindo a janela mais antiga necessária até hoje.
- `buildBriefingPrompt`: bloco `Hábitos da semana:\n- Academia: 1/3` (sempre que `habits.week` não vazio); se `lastWeek`, bloco `Semana passada (hábitos):\n- ...` + linha `Comente a semana passada: parabenize meta batida, motive sem cobrar quem ficou abaixo.`; se `lastMonth`, idem com `Mês passado (hábitos):`.
- `isEmptyBriefing`: `habits` com `week.length > 0` conta como conteúdo (`&& ctx.habits === null` na cadeia, com `habits: null` quando sem hábitos).
- `runCoupleBriefing`: `habits: null` (hábitos são individuais).

- [ ] **Step 1: Testes (falhando)**

Em `apps/server/src/jobs/briefing.test.ts`:

1. `baseCtx` ganha (depois de `cleanup`):

```ts
  habits: { week: [{ name: 'Academia', done: 1, target: 3 }], lastWeek: null, lastMonth: null },
```

2. Os literais de contexto vazio dos testes de `isEmptyBriefing` ganham `habits: null`.
3. No helper `deps()`, adicionar:

```ts
      listActiveHabits: async () => [],
      listHabitCheckins: async () => [],
```

4. Testes novos:

Em `describe('buildBriefingPrompt', ...)`:

```ts
  it('inclui o progresso da semana dos hábitos', () => {
    const p = buildBriefingPrompt(baseCtx);
    expect(p).toContain('Academia: 1/3');
  });
  it('retrô só quando presente no contexto', () => {
    const p = buildBriefingPrompt({
      ...baseCtx,
      habits: { week: [], lastWeek: [{ name: 'Academia', done: 3, target: 3 }], lastMonth: null },
    });
    expect(p).toContain('Semana passada');
    expect(p).toContain('parabenize');
    expect(buildBriefingPrompt(baseCtx)).not.toContain('Semana passada');
  });
```

Em `describe('isEmptyBriefing', ...)`:

```ts
  it('hábitos com progresso já são conteúdo', () => {
    expect(
      isEmptyBriefing({
        name: 'Esposa',
        date: '2026-07-15',
        agenda: [],
        tasks: [],
        queued: [],
        commitmentsToday: [],
        finance: null,
        cleanup: null,
        habits: { week: [{ name: 'Leitura', done: 2, target: 5 }], lastWeek: null, lastMonth: null },
      }),
    ).toBe(false);
  });
```

Em `describe('runDailyBriefing', ...)`:

```ts
  it('segunda-feira inclui retrô da semana anterior', async () => {
    const prompts: string[] = [];
    const d = deps({
      todayIso: () => '2026-07-13', // segunda
      listActiveHabits: async () => [{ id: 'h1', name: 'Academia', targetPerWeek: 3 }] as never,
      listHabitCheckins: async () => [
        { habitId: 'h1', date: '2026-07-08', done: true },
        { habitId: 'h1', date: '2026-07-10', done: true },
      ],
      generate: async (_s: string, prompt: string) => {
        prompts.push(prompt);
        return 'Bom dia!';
      },
    });
    await runDailyBriefing(async () => undefined, d);
    expect(prompts.some((p) => p.includes('Semana passada') && p.includes('Academia: 2/3'))).toBe(true);
  });
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/jobs/briefing.test.ts`
Expected: FAIL — `habits` não existe em `BriefingContext`.

- [ ] **Step 3: Implementar em `apps/server/src/jobs/briefing.ts`**

1. Imports novos:

```ts
import { listActiveHabits, listCheckinsBetween } from '../db/habits.js';
import {
  monthProgress,
  prevMonthRange,
  prevWeekRange,
  weekProgress,
  weekStart,
  type HabitProgress,
} from '../services/habit-stats.js';
```

2. `BriefingContext` ganha:

```ts
  habits: { week: HabitProgress[]; lastWeek: HabitProgress[] | null; lastMonth: HabitProgress[] | null } | null;
```

3. Em `buildBriefingPrompt`, antes do `return`:

```ts
  if (ctx.habits && ctx.habits.week.length > 0)
    parts.push(`Hábitos da semana:\n${ctx.habits.week.map((h) => `- ${h.name}: ${h.done}/${h.target}`).join('\n')}`);
  if (ctx.habits?.lastWeek)
    parts.push(
      `Semana passada (hábitos):\n${ctx.habits.lastWeek.map((h) => `- ${h.name}: ${h.done}/${h.target}`).join('\n')}\nComente a semana passada: parabenize meta batida, motive sem cobrar quem ficou abaixo.`,
    );
  if (ctx.habits?.lastMonth)
    parts.push(
      `Mês passado (hábitos):\n${ctx.habits.lastMonth.map((h) => `- ${h.name}: ${h.done}/${h.target}`).join('\n')}\nComente o mês passado: parabenize meta batida, motive sem cobrar quem ficou abaixo.`,
    );
```

4. `isEmptyBriefing` ganha `&& ctx.habits === null` (depois de `ctx.cleanup === null`).

5. `BriefingDeps` ganha:

```ts
  listActiveHabits: typeof listActiveHabits;
  listHabitCheckins: typeof listCheckinsBetween;
```

e `defaultBriefingDeps()` retorna também:

```ts
    listActiveHabits,
    listHabitCheckins: listCheckinsBetween,
```

6. Em `contextFor`, depois do bloco do `cleanup`:

```ts
  let habitsCtx: BriefingContext['habits'] = null;
  const activeHabits = await deps.listActiveHabits(user.id).catch(() => []);
  if (activeHabits.length > 0) {
    const isMonday = weekStart(today) === today;
    const isFirstOfMonth = today.endsWith('-01');
    const wFrom = weekStart(today);
    const pw = isMonday ? prevWeekRange(today) : null;
    const pm = isFirstOfMonth ? prevMonthRange(today) : null;
    const oldest = [wFrom, pw?.from, pm?.from].filter((x): x is string => Boolean(x)).sort()[0];
    const checkins = await deps.listHabitCheckins(activeHabits.map((h) => h.id), oldest, today).catch(() => []);
    habitsCtx = {
      week: weekProgress(activeHabits, checkins, wFrom, today),
      lastWeek: pw ? weekProgress(activeHabits, checkins, pw.from, pw.to) : null,
      lastMonth: pm ? monthProgress(activeHabits, checkins, pm.from, pm.to) : null,
    };
  }
```

e o `ctx` retornado inclui `habits: habitsCtx`.

7. Em `runCoupleBriefing`, o literal `ctx` ganha `habits: null`.

- [ ] **Step 4: Rodar e ver passar (arquivo inteiro)**

Run: `npx vitest run apps/server/src/jobs/briefing.test.ts`
Expected: PASS (novos e antigos).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/jobs/briefing.ts apps/server/src/jobs/briefing.test.ts
git commit -m "feat(f7): bloco de hábitos no briefing (semana corrente + retrôs de segunda e dia 1º)"
```

---

### Task 6: Coletor de projetos parados (`proactive/collect-projects.ts`)

**Files:**
- Create: `apps/server/src/proactive/collect-projects.ts`
- Create: `apps/server/src/proactive/collect-projects.test.ts`
- Modify: `apps/server/src/proactive/engine.ts` (`CollectorSource` + `defaultEngineDeps`)

**Interfaces:**
- Consumes: `insertEvent` (`db/events.ts`); `listActiveProjects` (Task 1); `weekStart` (Task 2); `getUserBySubject`; `todayInTz`, `getConfig`.
- Produces (usada pela Task 7): `collectProjectEvents(deps?: ProjectCollectorDeps): Promise<number>`; `CollectorSource` passa a incluir `'projects'`.

**Comportamento:** para cada subject (try/catch por pessoa), projetos ativos com `updatedAt` ≤ hoje−10 dias viram evento kind `project_stale`, dedupe `proj:stale:<id>:<weekStart(hoje)>` (re-emite no máximo 1x/semana), summary `Projeto parado: "<nome>" (<Pessoa>) sem novidades há <N> dias`.

- [ ] **Step 1: Testes (falhando)**

`apps/server/src/proactive/collect-projects.test.ts`:

```ts
import '../test-setup.js';
import { describe, expect, it } from 'vitest';
import { collectProjectEvents, type ProjectCollectorDeps } from './collect-projects.js';

function deps(over: Partial<ProjectCollectorDeps> = {}) {
  const inserted: Array<{ kind: string; dedupeKey: string; summary: string }> = [];
  const d: ProjectCollectorDeps = {
    getUserBySubject: async (s) => (s === 'luis' ? ({ id: 'u1', name: 'Luis', calendarId: null } as never) : null),
    listActiveProjects: async () => [],
    insertEvent: async (e) => {
      inserted.push(e as never);
      return { id: 'e1' } as never;
    },
    todayIso: () => '2026-07-16', // quinta; segunda = 2026-07-13
    ...over,
  };
  return { d, inserted };
}

describe('collectProjectEvents', () => {
  it('projeto parado há >=10 dias vira evento com dedupe semanal', async () => {
    const { d, inserted } = deps({
      listActiveProjects: async () => [
        { id: 'p1', name: 'Site', status: null, updatedAt: '2026-07-01T10:00:00Z' }, // 15 dias
        { id: 'p2', name: 'Loja', status: null, updatedAt: '2026-07-14T10:00:00Z' }, // 2 dias: não
      ],
    });
    expect(await collectProjectEvents(d)).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].kind).toBe('project_stale');
    expect(inserted[0].dedupeKey).toBe('proj:stale:p1:2026-07-13');
    expect(inserted[0].summary).toContain('Site');
    expect(inserted[0].summary).toContain('15 dias');
  });

  it('dedupe repetido não conta; falha de um usuário não derruba o outro', async () => {
    const { d } = deps({
      getUserBySubject: async (s) => {
        if (s === 'luis') throw new Error('boom');
        return { id: 'u2', name: 'Esposa', calendarId: null } as never;
      },
      listActiveProjects: async () => [{ id: 'p1', name: 'X', status: null, updatedAt: '2026-07-01T00:00:00Z' }],
      insertEvent: async () => null, // já existia
    });
    expect(await collectProjectEvents(d)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run apps/server/src/proactive/collect-projects.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/server/src/proactive/collect-projects.ts`:

```ts
import { getUserBySubject } from '../db/chats.js';
import { insertEvent } from '../db/events.js';
import { listActiveProjects } from '../db/projects.js';
import { getConfig } from '../lib/config.js';
import { todayInTz } from '../lib/dates.js';
import { weekStart } from '../services/habit-stats.js';

const STALE_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ProjectCollectorDeps = {
  getUserBySubject: typeof getUserBySubject;
  listActiveProjects: typeof listActiveProjects;
  insertEvent: typeof insertEvent;
  todayIso: () => string;
};

const defaultDeps: ProjectCollectorDeps = {
  getUserBySubject,
  listActiveProjects,
  insertEvent,
  todayIso: () => todayInTz(getConfig().TIMEZONE),
};

/** Projeto ativo sem movimento (nota/tarefa/status) há N dias → evento; dedupe 1x/semana. */
export async function collectProjectEvents(deps: ProjectCollectorDeps = defaultDeps): Promise<number> {
  const today = deps.todayIso();
  const week = weekStart(today);
  const todayMs = new Date(`${today}T12:00:00Z`).getTime();
  let inserted = 0;
  for (const subject of ['luis', 'esposa'] as const) {
    try {
      const user = await deps.getUserBySubject(subject);
      if (!user) continue;
      for (const p of await deps.listActiveProjects(user.id)) {
        const days = Math.floor((todayMs - new Date(p.updatedAt).getTime()) / MS_PER_DAY);
        if (days < STALE_DAYS) continue;
        const r = await deps.insertEvent({
          source: 'projects',
          kind: 'project_stale',
          dedupeKey: `proj:stale:${p.id}:${week}`,
          summary: `Projeto parado: "${p.name}" (${user.name}) sem novidades há ${days} dias`,
        });
        if (r) inserted++;
      }
    } catch (err) {
      console.error(`[collect-projects] falhou para ${subject}:`, err);
    }
  }
  return inserted;
}
```

Em `apps/server/src/proactive/engine.ts`:
- `export type CollectorSource = 'finance' | 'calendar' | 'tasks' | 'projects';`
- Import: `import { collectProjectEvents } from './collect-projects.js';`
- Em `defaultEngineDeps()`, no objeto `collectors`, junto de `tasks`:

```ts
    tasks: () => collectTaskEvents(),
    projects: () => collectProjectEvents(),
```

- [ ] **Step 4: Rodar e ver passar (novo + engine)**

Run: `npx vitest run apps/server/src/proactive/collect-projects.test.ts apps/server/src/proactive/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w apps/server
git add apps/server/src/proactive
git commit -m "feat(f7): coletor de projetos parados (source projects, dedupe semanal)"
```

---

### Task 7: Crons, script manual, SETUP.md §9 e verificação final

**Files:**
- Modify: `apps/server/src/jobs/scheduler.ts` (cron 21:00 + projects no ciclo das 06:30 + log)
- Modify: `apps/server/src/scripts/run-proactive.ts` (sources com `projects`)
- Create: `apps/server/src/scripts/run-checkin.ts`
- Modify: `apps/server/package.json` (script `job:checkin`)
- Modify: `SETUP.md` (seção "## 9. Fase 7")

**Interfaces:**
- Consumes: `runDailyCheckin`, `type SendWithKb` (Task 4); `CollectorSource` com `projects` (Task 6); scheduler atual (crons existentes INTOCADOS).

- [ ] **Step 1: Editar `apps/server/src/jobs/scheduler.ts`**

Imports novos:

```ts
import { runDailyCheckin } from './daily-checkin.js';
```

Trocar a linha do cron das tarefas por (única mudança em cron existente — o ciclo ganha o coletor de projetos):

```ts
  cron.schedule('30 6 * * *', cycle(['tasks', 'projects'], 'tasks+projects'), opts);
```

Depois do cron do bibliotecário, adicionar:

```ts
  // Check-in de hábitos + tarefas vencidas (Fase 7): rotina direta, sem juiz
  cron.schedule('0 21 * * *', () => {
    runDailyCheckin((chatId, text, kb) =>
      bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
    ).catch((err) => console.error('[job:checkin]', err));
  }, opts);
```

E no `console.log` final, acrescentar `check-in 21:00,` logo depois de `briefing 07:00 (+casal sáb 08:00),` e trocar `tarefas 06:30` por `tarefas+projetos 06:30` (resto da linha igual).

- [ ] **Step 2: `apps/server/src/scripts/run-proactive.ts`** — trocar a linha das sources por:

```ts
const out = await runProactiveCycle(['finance', 'calendar', 'tasks', 'projects'], (chatId, text) =>
```

- [ ] **Step 3: Script manual + npm script**

`apps/server/src/scripts/run-checkin.ts`:

```ts
// Roda o check-in das 21:00 manualmente (uso: npm run job:checkin -w apps/server)
import { Bot } from 'grammy';
import { runDailyCheckin } from '../jobs/daily-checkin.js';
import { getConfig } from '../lib/config.js';

const bot = new Bot(getConfig().TELEGRAM_TOKEN);
await runDailyCheckin((chatId, text, kb) =>
  bot.api.sendMessage(chatId, text, kb ? { reply_markup: kb } : undefined).then(() => undefined),
);
console.log('check-in enviado (se havia pendências)');
```

Em `apps/server/package.json`, adicionar aos `scripts` (depois de `"job:librarian"`, atenção à vírgula):

```json
    "job:checkin": "tsx src/scripts/run-checkin.ts"
```

- [ ] **Step 4: SETUP.md** — adicionar seção ao final (depois da seção 8, antes de "## Notas"):

```markdown
## 9. Fase 7 (hábitos + projetos)

1. **Migração**: executar `supabase/migrations/0006_fase7.sql` (SQL Editor ou
   Management API).
2. **Hábitos**: crie por conversa ("quero acompanhar academia 3x por semana").
   Todo dia às 21:00 o bot pergunta um por um, com botões ✅/❌ — responder
   por texto também vale ("fui na academia"). O briefing mostra o progresso
   da semana; segunda-feira traz a retrô da semana anterior e o dia 1º a do
   mês.
3. **Projetos**: "cria o projeto Site", "no projeto Site decidi usar Astro",
   "tarefa 'wireframe' no Site para sexta", "como está o Site?". Tarefa
   vencida aparece no check-in das 21:00 (✅ concluí / ❌ segue); projeto
   sem novidades há 10 dias aparece no briefing.
4. **Teste manual**: `npm run job:checkin -w apps/server` (envia as
   perguntas pendentes agora).
```

- [ ] **Step 5: Rodar TODOS os testes e typecheck**

Run: `npx vitest run` (raiz)
Expected: PASS na suíte inteira (sem regressões).

Run: `npm run typecheck -w apps/server`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/jobs/scheduler.ts apps/server/src/scripts/run-proactive.ts apps/server/src/scripts/run-checkin.ts apps/server/package.json SETUP.md
git commit -m "feat(f7): cron do check-in 21:00 + projetos no ciclo da proatividade + setup"
```

---

## Pós-merge (operacional — controlador + Luis)

1. **Merge** na master local (finishing-a-development-branch, opção 1).
2. **Migração 0006** aplicada em produção pelo controlador (Management API) — pedir ok ao Luis.
3. **Luis:** `git push`; VPS puxa em até 30min (ou FORCE deploy). Nada novo no `.env`.
4. **UAT:**
   - "Quero acompanhar academia 3x por semana" → hábito criado (`habit_list` mostra 0/3).
   - `npm run job:checkin` → "Academia hoje?" com ✅/❌; clicar ✅ → mensagem editada; sem mais pendências, silêncio.
   - "Cria o projeto Site" + "no Site, tarefa 'proposta' para ontem" → `job:checkin` de novo → pergunta da tarefa vencida com ✅/❌.
   - Briefing de amanhã: "Academia 1/3"; na segunda: retrô da semana.
   - `job:proactive` → projeto sem movimento não aparece (10 dias); conferir `event_queue` depois de 10 dias ou ajustar `updated_at` no banco para testar.
