# Fase 8 — Web app (controle do assistente + domínios)

**Data:** 2026-07-16 · **Status:** aprovado no brainstorm (abordagem C — híbrido)

## 1. Escopo

O web app (F1.5, servido pelo Hono na 8080) ganha as páginas que dão
visibilidade e controle sobre o assistente e os domínios que hoje só existem
no chat:

- **Tarefas** — CRUD completo: lista por pessoa (Luis/esposa), filtro
  aberto/concluído, prazo opcional; concluir marca `done_at`.
- **Compras** — lista única do casal: adicionar, editar nome, remover.
  "Comprado" = remover da lista (a tabela não tem status; é o comportamento
  do chat — sem migração de schema).
- **Hábitos** — CRUD (nome, meta semanal 1–7, arquivar via `active=false`) +
  grade da semana/mês com os check-ins; clicar num dia alterna ✅/❌/sem
  registro (upsert/delete em `habit_checkins`, `unique(habit_id, date)`).
- **Projetos** — lista de projetos ativos; detalhe com quadro
  (todo/doing/done), tarefas com prazo, linha do tempo
  (status/decisão/nota). Ações: criar/mover/concluir tarefa, adicionar nota
  ou decisão, arquivar projeto. **Toda escrita toca `projects.updated_at`**
  (o coletor de "projeto parado ≥10d" da F4/F7 depende disso).
- **Memórias** — tabela com filtros (pessoa, tipo, ativas/expiradas) e busca
  textual (`ilike`); editar conteúdo (via API, com re-embedding), desativar/
  reativar (o "esquecer" do chat) e excluir definitivo.
- **Configurações** (expande a página atual de tema+bancos):
  - **Silêncio e teto** — edita `app_state.proactivity_config`
    (quietStart/quietEnd `HH:MM`, maxNotificationsPerDay 1–20), que o motor
    de proatividade já relê a cada ciclo.
  - **Rotinas** — horário e liga/desliga de cada uma das 4 rotinas visíveis
    (briefing, briefing do casal, revisão financeira, check-in 21:00), em
    `app_state.routines_config`.
  - **Custo LLM** — card com gasto do mês vs teto (barra) + quebra por
    finalidade (purpose), via `GET /api/llm-cost`. Sem página própria.

**Fora da fase**: melhorias do dashboard financeiro (9 itens do backlog da
F1.5 — agregação SQL, paginação, modais, % variação, mobile do dashboard);
criação de memórias pelo web (só o servidor cria, embedding obrigatório);
horários dos jobs internos (reflexão, bibliotecário, coletores, gmail —
crons fixos); segregação de dados entre as duas contas (app do casal).

## 2. Arquitetura (abordagem C — híbrido)

Decisão: **CRUD direto no Supabase** (supabase-js + Auth + RLS, o mesmo
padrão das páginas de finanças herdadas da v1) para tudo que é leitura e
escrita simples; **API Hono** só onde a operação precisa do servidor
(segredo ou lógica que não pode ficar no cliente).

```
web (React) ──supabase-js/RLS──> tasks, shopping_items, habits,
                                 habit_checkins, projects, project_notes,
                                 project_tasks, memories (sem insert),
                                 users (leitura), app_state (só chaves de
                                 config)

web (React) ──fetch + JWT──────> PUT /api/memories/:id   (re-embedding)
                                 GET /api/llm-cost        (gasto + teto)

scheduler ──tick 1 min──> app_state.routines_config (dispara rotina cujo
                          HH:MM local bate e enabled=true)
```

**Migração 0007** (`supabase/migrations/0007_fase8.sql`, já escrita):
policies `to authenticated` — `for all using(true)` nas 7 tabelas de
domínio; `memories` sem insert (select/update/delete); `users` só select;
`app_state` restrito às chaves `proactivity_config` e `routines_config`
(cursores internos continuam invisíveis); `llm_usage` sem policy (custo sai
pelo endpoint). Aplicar em produção via Management API **no deploy da fase**.

**Endpoints** (`apps/server/src/api/`): autenticação por
`Authorization: Bearer <access_token>` do Supabase Auth — o servidor valida
o token (`auth.getUser`) e responde 401 se inválido; por trás usa a service
role, como o resto do servidor.

- `PUT /api/memories/:id` `{ content }` → gera embedding novo (modelo de
  embedding já configurado, registra em `llm_usage` como as demais
  chamadas), atualiza `content`+`embedding`+`updated_at`; 404 se não existe.
- `GET /api/llm-cost` → `{ spentBrl, budgetBrl, byPurpose: [{purpose,
  costBrl}] }` — `sum_month_cost_brl()` já existe; a quebra por purpose é um
  `group by` do mês corrente.

**Scheduler dinâmico** (`apps/server/src/jobs/scheduler.ts`): as 4 rotinas
visíveis deixam de ser crons fixos e viram um tick `* * * * *` que lê
`routines_config` (merge com defaults `07:00/08:00/08:00/21:00`, todos
enabled) e dispara a rotina cujo `HH:MM` no fuso `TIMEZONE` bate com o
minuto corrente. Briefing do casal continua restrito a sábado (weekday fixo;
só o horário é configurável). Mudança no web vale no minuto seguinte, sem
restart. Jobs internos continuam crons fixos.

```
routines_config = {
  briefing:       { time: '07:00', enabled: true },
  coupleBriefing: { time: '08:00', enabled: true },   // só sábado
  financeReview:  { time: '08:00', enabled: true },
  checkin:        { time: '21:00', enabled: true },
}
```

## 3. UX

Páginas novas seguem os padrões existentes: `Layout`, cards, `Modal.tsx`
(nada de `alert()`), tabelas, tema claro/escuro via tokens atuais,
responsivas desde o início. Sem biblioteca nova — React Router + Tailwind +
Recharts cobrem tudo (grade de hábitos em CSS puro). Rotas novas:
`/tarefas`, `/compras`, `/habitos`, `/projetos` (+ detalhe), `/memorias`;
Configurações continua em `/configuracoes`.

## 4. Erros e testes

- **Vitest (servidor)**: tick do scheduler (bate horário no fuso,
  `enabled=false` não dispara, config ausente = defaults, casal só sábado);
  `PUT /api/memories/:id` (401 sem/with JWT inválido, re-embedding chamado,
  404 id inexistente); `GET /api/llm-cost` (soma + quebra). LLM mockado.
- **Web**: sem testes unitários de UI (backlog conhecido da F1.5); smoke
  E2E antes do deploy (build + páginas respondem).
- **Erros de gravação no web**: mensagem inline/toast no padrão das páginas
  de finanças; falha de rede não perde o formulário.

## 5. Critério da fase

Pelo navegador: ver e editar tudo que o assistente sabe (memórias), quanto
gastou (custo vs teto), quando e se ele fala (rotinas + silêncio), e operar
tarefas/compras/hábitos/projetos sem abrir o chat.
