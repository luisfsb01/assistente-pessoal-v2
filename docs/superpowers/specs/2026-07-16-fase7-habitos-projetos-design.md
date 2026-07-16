# Fase 7 — Hábitos + Projetos

**Data:** 2026-07-16 · **Status:** aprovado no brainstorm (opção A + botões)

## 1. Escopo

**Hábitos** (Luis e esposa, cada um os seus):
- Definição por conversa ("quero acompanhar academia 3x por semana") — todo
  hábito tem **meta semanal** (`target_per_week`, 1–7).
- **Check-in das 21:00** no privado de cada um: para cada hábito SEM registro
  no dia, o bot manda UMA mensagem por vez com botões **✅ / ❌** ("Academia
  hoje?"); o clique registra o dia (feito/não feito), edita a mensagem
  (padrão da revisão financeira) e dispara a pergunta do próximo pendente.
  Responder por texto também funciona (tool de check-in continua disponível
  ao agente).
- **Briefing matinal**: bloco de hábitos com o progresso da semana corrente
  ("academia 1/3 nessa semana"); às **segundas**, retrospectiva da semana
  anterior por hábito; no **dia 1º do mês**, retrospectiva do mês anterior —
  os números saem de agregação pura; a frase de motivação (abaixo da meta)
  ou parabéns (meta batida) quem escreve é o modelo forte do briefing.
- Semana começa na **segunda-feira**. "Não fiz" também é registro (conta na
  tendência e não repergunta no dia).

**Projetos** (por dono, alimentado por conversa):
- Registro: "no projeto X decidi tal coisa" / "status do X: aguardando
  cliente" → linha do tempo (`project_notes`, kinds `status|decision|note`);
  "como está o projeto X?" responde com status atual + últimas notas +
  quadro de tarefas.
- **Quadro de tarefas por projeto**: to do / doing / done, com prazo
  opcional ("no projeto X, tarefa 'enviar proposta' para sexta").
- **Cobrança de pendências**:
  - Tarefa de projeto com **prazo estourado**: entra no check-in das 21:00,
    depois dos hábitos, com botões **✅ concluí / ❌ segue pendente**
    (✅ move para done; ❌ só registra que segue).
  - **Projeto parado** (sem nota nem movimentação de tarefa há 10 dias):
    coletor novo da F4 (source `projects`) → julgamento → briefing/aviso.

**Fora da fase**: preparação da semana (bloco de projetos na segunda — pode
entrar depois), integração com repositórios/git, UI web (F8), hábitos do
casal compartilhados (só individuais por ora).

## 2. Arquitetura

Mesmo padrão das fases anteriores: tabelas + tools injetáveis + jobs em cron
+ blocos no briefing + coletor na F4.

```
Migração 0006: habits, habit_checkins, projects, project_notes,
               project_tasks + event_queue.source aceita 'projects'

21:00 (cron, por usuário, privado) — jobs/daily-checkin.ts
  hábitos sem registro hoje → 1 mensagem com ✅/❌ por vez (callback
  registra, edita a mensagem e envia a próxima) → depois, tarefas de
  projeto vencidas → ✅ concluí / ❌ segue pendente
  (job direto como o briefing: não passa pelo juiz nem conta no teto da F4)

07:00 briefing — bloco de hábitos (semana corrente; retrô semanal às
  segundas; retrô mensal no dia 1º)

06:30 coletor projects (junto do de tarefas) — projeto parado ≥10 dias
  → event_queue → julgamento F4 → briefing/notificação

Chat — tools: habit_define/habit_list/habit_checkin/habit_archive,
  project_create/project_note/project_set_status/project_overview,
  project_task_add/project_task_move/project_task_list
```

## 3. Modelo de dados (migração 0006)

- `habits`: id, user_id → users, name, target_per_week int (1–7), active
  bool default true, created_at.
- `habit_checkins`: id, habit_id → habits, date (date), done bool,
  created_at, **unique(habit_id, date)** — um registro por dia; reclique
  atualiza (upsert).
- `projects`: id, user_id → users, name, status text (livre, curto), active
  bool default true, created_at, updated_at.
- `project_notes`: id, project_id → projects, kind check
  ('status','decision','note'), content, created_at.
- `project_tasks`: id, project_id → projects, title, status check
  ('todo','doing','done') default 'todo', due_date date null, created_at,
  done_at timestamptz null.
- `event_queue.source` check ganha `'projects'`.
- RLS on em todas (service role, como as demais).

## 4. Decisões de design

- **Check-in sequencial sem máquina de estados**: "próxima pergunta" =
  primeiro hábito sem check-in do dia (consulta ao banco no momento do
  callback). Clique duplo/atrasado é inofensivo (upsert por unique). As
  mensagens usam callback_data compacto (`hab:<sim|nao>:<habitId>` e
  `ptask:<done|keep>:<taskId>`), handlers no bot ao lado dos da revisão
  financeira.
- **21:00 é rotina, não proatividade**: envia direto (como briefing), sem
  julgamento e fora do teto diário; 21:00 < 22:00 (silêncio) por design. Se
  não há pendência, não manda nada (silêncio > ruído).
- **Agregação de hábitos pura**: função que recebe checkins + meta e devolve
  `{ feito, meta }` por hábito para uma janela (semana corrente, semana
  anterior, mês anterior). O briefing injeta os números no prompt e instrui
  o modelo a comentar (motivar/parabenizar) — nada de frase hard-coded.
- **Projeto "parado"**: sem `project_notes` novo E sem mudança em
  `project_tasks` há 10 dias (max de created_at/done_at/updated_at);
  dedupe semanal (`proj:stale:<id>:<segunda-da-semana>`), igual ao padrão
  do coletor de tarefas.
- **Owner**: hábitos e projetos têm dono (luis/esposa); no grupo, o agente
  pergunta de quem é (regra que já existe para tarefas).
- **Tendência = consistência**: % de metas batidas nas últimas semanas fica
  derivável de `habit_checkins`; nesta fase só semana/mês anterior no
  briefing — gráficos ficam para a UI da F8.

## 5. Erros e custo

- Padrão do repo: try/catch por usuário nos jobs (um não derruba o outro);
  tools com FAIL amigável; callbacks idempotentes.
- Custo: check-in não usa LLM (botões + textos fixos); briefing já usa o
  modelo forte (bloco novo só acrescenta ~10 linhas de prompt); coletor de
  projetos usa o julgamento barato existente. Impacto marginal.

## 6. Testes

Padrão do repo: deps fakes, vitest, `test-setup` quando tocar `db/client`.
Casos-chave: agregação de semana/mês (fronteiras: segunda, dia 1º, hábito
criado no meio da semana); check-in não repergunta hábito já registrado;
callback registra e dispara o próximo; tarefa vencida ✅ vira done; coletor
de stale respeita 10 dias e dedupe; briefing inclui retrô só na segunda/dia
1º; grupo não recebe check-in.

## 7. Critério de aceite (UAT)

1. "Quero acompanhar academia 3x por semana e leitura 5x" → hábitos criados.
2. 21:00: chega "Academia hoje?" com ✅/❌; clicar ✅ registra e vem a
   próxima pergunta; no fim, tarefas de projeto vencidas (se houver).
3. Briefing seguinte: "academia 1/3 nessa semana"; na segunda, retrô da
   semana com frase de motivação/parabéns; no dia 1º, retrô do mês.
4. "No projeto Site decidi usar Astro" + "tarefa 'wireframe' para sexta" →
   "como está o Site?" responde status + decisão + quadro.
5. Projeto sem movimento por 10 dias aparece no briefing.
