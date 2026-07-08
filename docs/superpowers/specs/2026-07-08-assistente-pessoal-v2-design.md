# Assistente Pessoal v2 — Design

Data: 2026-07-08
Status: aprovado em conversa com Luis (brainstorming completo)

## 1. Contexto e objetivo

A v1 (`../assistente-pessoal/`) funciona em produção — bot Telegram para Luis e
esposa com tarefas, agenda (Google Calendar), lista de compras, finanças (Banco
MCP/Open Finance) e web app com dashboard — mas é **rasa**: sem memória entre
conversas, proatividade limitada a resumos em horário fixo, sem raciocínio
multi-passo, conversa presa a comandos e botões.

A v2 é um **recomeço do zero, sem migração de dados**. A v1 continua rodando
até a v2 estar madura; depois é desligada. O objetivo é um salto de
inteligência, não de features: um assistente que lembra, aprende, percebe e
age com critério.

### Decisões tomadas (com o usuário)

| Decisão | Escolha |
|---|---|
| Relação com a v1 | Do zero, sem migrar dados; v1 roda em paralelo até a virada |
| Canal | **Telegram** (WhatsApp avaliado e descartado: custo baixo mas fricção de templates/número dedicado; não-oficial tem risco de ban) |
| Usuários | Luis + esposa: chat privado de cada um + grupo do casal |
| Fundação | **Construção própria** (OpenClaw avaliado e descartado: single-user, guloso de tokens, superfície de segurança grande; o valor único — casal, finanças estruturadas, orçamento apertado — teria que ser construído de qualquer jeito) |
| Stack | Node/TS, monorepo, 1 serviço Docker no VPS Hostinger, Supabase novo (free tier), grammY, **Vercel AI SDK** (agnóstico a modelo), Hono + React/Vite |
| Modelos | Híbrido: **GPT-5 mini** no dia a dia, modelo forte (GPT-5.5 ou Claude Sonnet) para briefing/análises/pedidos complexos. Troca de provedor = 1 linha |
| Orçamento LLM | **≤ R$ 50/mês**, com guarda de custo automática |
| Web app | **Dashboard financeiro completo** (paridade com v1) + configurações + tela de memórias |
| Segundo cérebro | Vault **Obsidian** criado do zero, método **LLM Wiki (Karpathy, abr/2026)**, sync via **Syncthing** |

### Capacidades-alvo (o que "inteligente" significa aqui)

1. **Memória de longo prazo** — lembra preferências, hábitos, decisões, pessoas.
2. **Proatividade com critério** — percebe eventos (gasto atípico, e-mail
   importante, conflito de agenda, tarefa parada) e julga se/quando/como avisar.
3. **Raciocínio multi-passo** — cruza domínios num pedido só ("organiza minha
   semana considerando prazos e orçamento").
4. **Conversa natural** — texto livre, contexto, autocorreção, pergunta quando
   tem dúvida; botões só para confirmações rápidas.

### Domínios

Tarefas, agenda, compras, finanças (v1) **+** triagem de Gmail, briefing diário
unificado, hábitos, acompanhamento de projetos, segundo cérebro (novos).

## 2. Arquitetura

```
Telegram ─ privado Luis ──┐
Telegram ─ privado esposa ┼─⇄ Bot (grammY, long polling, whitelist)
Telegram ─ grupo casal ───┘        │
Browser ── SPA React ⇄ API Hono ───┤
                            ┌──────▼──────────────────────────────┐
                            │ Serviço Node/TS único (Docker, VPS) │
                            │ • agent/    loop + roteador modelos │
                            │ • memory/   fatos + reflexão        │
                            │ • proactive/ eventos + julgamento   │
                            │ • knowledge/ vault + wiki + índice  │
                            │ • tools/    8 domínios              │
                            │ • jobs/     cron (briefing, etc.)   │
                            └──┬──────┬──────┬──────┬─────────────┘
                          Supabase  Google  Banco   Vault Obsidian
                          (+pgvector) APIs   MCP    (pasta + Syncthing)
                                   (Calendar,(Open
                                    Gmail)   Finance)
```

Um único processo: bot + agente + jobs + API + SPA estática. Um deploy.
Projeto Supabase novo, bot novo no @BotFather — zero acoplamento com a v1.

### Estrutura do monorepo

```
assistente-pessoal-v2/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── index.ts     # bootstrap
│   │       ├── bot/         # grammY: handlers, identidade por chat_id, whitelist
│   │       ├── agent/       # Vercel AI SDK: loop multi-step, prompts por contexto,
│   │       │                #   roteador de modelos, registro de tools
│   │       ├── tools/       # tasks, calendar, shopping, finance, email, habits,
│   │       │                #   projects, knowledge
│   │       ├── memory/      # ★ fatos duráveis, recall semântico, reflexão noturna
│   │       ├── proactive/   # ★ coletores de eventos, julgamento, regras de silêncio
│   │       ├── knowledge/   # ★ captura de artigos, bibliotecário do wiki, consulta
│   │       ├── jobs/        # briefing, check-ins, reflexão, bibliotecário, coletores
│   │       ├── api/         # Hono: REST p/ SPA + estáticos
│   │       ├── db/          # cliente Supabase + queries
│   │       └── lib/         # google-auth, banco-mcp, custo/llm_usage, config
│   └── web/                 # React + Vite + Tailwind + Recharts
├── supabase/migrations/
├── vault/                   # (no VPS) Obsidian: Sources/ + Wiki/
├── Dockerfile / docker-compose.yml
└── .env.example
```

★ = subsistemas novos em relação à v1; são o núcleo do projeto.

## 3. O cérebro

### 3.1 Agente

Loop multi-step do Vercel AI SDK (`generateText` + tools + maxSteps). O
contexto injetado depende do chat: privado do Luis = todos os domínios;
privado da esposa = tarefas/agenda/compras/hábitos dela; grupo = assuntos do
casal (compras, agenda comum, resumos). Identidade resolvida por `chat_id`
(whitelist). Botões inline apenas para confirmações rápidas (ex. classificar
transação); todo o resto é conversa.

### 3.2 Memória em 3 camadas

1. **Curta**: últimas N mensagens do chat (tabela `messages`), como na v1.
2. **Longa**: tabela `memories` — fatos tipados
   (`preference | habit | fact | decision | person`), com colunas: texto,
   tipo, sujeito (Luis/esposa/casal), embedding (pgvector), origem,
   `created_at`/`updated_at`, `expires_at` opcional. A cada mensagem, top-K
   fatos relevantes (busca semântica + recência) entram no prompt.
3. **Reflexão**: job noturno relê as conversas do dia com modelo barato e
   destila: fatos novos, atualizações de fatos existentes (upsert por
   similaridade), expiração de obsoletos. Feedback do usuário sobre a conduta
   do assistente ("não precisava avisar isso") vira memória de preferência.

Transparência: tela "Memórias" no web app lista tudo, com editar/apagar.

### 3.3 Roteador de modelos + guarda de custo

- Default: **GPT-5 mini** (US$ 0,25/2,00 por Mtok).
- Escalonamento para modelo forte quando: job de briefing, análise financeira,
  pedido que toca 2+ domínios, ou o mini sinalizar que precisa (heurística
  simples primeiro; refinar depois).
- Toda chamada grava em `llm_usage` (modelo, tokens in/out, custo estimado,
  finalidade). Em ~80% do teto mensal (R$ 50) → aviso no privado do Luis; em
  100% → degrada tudo para o mini até virar o mês (nunca para de funcionar).
- Provedor trocável em 1 linha (AI SDK); nenhuma feature pode depender de
  recurso exclusivo de um provedor.

## 4. Motor de proatividade

### Coletores de eventos (jobs em intervalo)

| Fonte | Intervalo | Eventos |
|---|---|---|
| Banco MCP | ~2h | transação nova, gasto fora do padrão, fatura fechando, compromisso do dia X |
| Gmail | ~15min | e-mail com cobrança/prazo/urgência de remetente relevante |
| Calendar | ~30min | conflito, evento novo/alterado, compromisso amanhã cedo |
| Tarefas | diário | parada há N dias, prazo estourando |
| Hábitos | no horário do hábito | check-in não realizado |

### Julgamento

Cada evento → chamada do modelo barato com memórias relevantes no contexto →
decide: **(a) notificar agora** (e para quem: Luis, esposa ou grupo),
**(b) guardar para o briefing**, **(c) ignorar**. Eventos guardados vão para a
tabela `event_queue` com a decisão e o motivo (auditável).

### Regras de respeito (configuráveis no web app)

Horário de silêncio (default 22h–7h), máximo de interrupções/dia por pessoa,
destino por tipo de evento. Reações negativas do usuário alimentam a reflexão.

### Briefing matinal unificado

Job diário (horário configurável, default 7h) com **modelo forte**: cruza
agenda do dia, tarefas, e-mails importantes, situação financeira do mês,
hábitos e eventos guardados de ontem, e escreve uma **análise curta e opinada**
(não uma lista). Individual no privado; visão do casal no grupo aos sábados.

## 5. Domínios (tools)

| Domínio | Tools (resumo) | Fonte | Observações |
|---|---|---|---|
| Tarefas | CRUD por pessoa, prazos | Supabase | conversa livre |
| Agenda | CRUD eventos, 2 agendas | Google Calendar | OAuth único do Luis; agenda da esposa compartilhada (modelo da v1) |
| Compras | lista compartilhada | Supabase | vive no grupo |
| Finanças | transações (auto+manual), categorias/metas, compromissos mensais, objetivos, investimentos | Banco MCP + Supabase | Banco MCP é read-only; categorização sugerida pelo modelo + confirmação por botões |
| E-mail | triagem, resumo, busca, salvar artigo, rascunho | Gmail API | só a conta do Luis; escopo mínimo (read + labels + draft); **nunca envia e-mail** |
| Hábitos | definir, check-in conversacional, tendências | Supabase | check-ins disparados pelo motor de proatividade |
| Projetos | registrar status/decisões, cobrar pendências, preparar a semana | Supabase + memórias | alimentado por conversa; sem integração com repositórios por ora |
| Conhecimento | salvar artigo, consultar wiki/notas | Vault + pgvector | ver §6 |

## 6. Segundo cérebro (método LLM Wiki de Karpathy)

```
vault/
├── Sources/   # imutáveis: artigos capturados, com frontmatter
│              #   (título, url, origem, data, tags) + conteúdo extraído
└── Wiki/      # do agente: páginas de conceitos/entidades/comparações,
               #   Index.md, [[links]] entre páginas
```

- **Captura**: (a) encaminhar e-mail para o bot, (b) mandar link no chat,
  (c) label `assistente/salvar` no Gmail (coletor pega). Extração do conteúdo
  → nota em `Sources/` → resposta curta com o resumo no chat.
- **Bibliotecário** (job noturno, modelo barato, processa só o que é novo):
  para cada fonte nova, cria/atualiza as páginas do `Wiki/` afetadas, mantém
  links e o índice. Sources nunca são modificadas.
- **Consulta**: tool `knowledge_search` (pgvector sobre Sources+Wiki) +
  navegação pelos links; respostas citam as notas.
- **Sync**: Syncthing entre VPS ↔ PC Windows ↔ celular (Obsidian mobile).
  Setup documentado na fase 6.

## 7. Web app

React + Vite + Tailwind + Recharts, servido pelo serviço; Supabase Auth
(2 contas) + RLS.

- **Dashboard financeiro** (paridade com a v1): KPIs (receitas, despesas,
  saldo período/ano), filtros temporais, receitas×despesas + saldo acumulado,
  categoria vs meta, top subcategorias, objetivos com progresso,
  investimentos; página de transações (filtros, CRUD, edição em lote,
  import/export).
- **Configurações**: rotinas (o quê → chat → horário), regras de silêncio,
  categorias/metas, compromissos mensais, hábitos, tema escuro.
- **Memórias**: listar/editar/apagar tudo que o assistente sabe.
- **Custo LLM**: gasto do mês vs teto.
- Visualização de tarefas e compras.

## 8. Dados (Supabase, principais tabelas)

`users`, `chats`, `messages` (histórico), `memories` (+pgvector),
`event_queue` (proatividade, com decisão e motivo), `routing_config`
(rotinas/horários/destinos/silêncio), `tasks`, `shopping_items`,
`categories`/`subcategories` (tipo, meta), `transactions` (origem
bank|manual, status de revisão), `financial_commitments`, `goals`,
`investments`, `habits` + `habit_checkins`, `projects` + `project_notes`,
`knowledge_index` (chunks + embeddings de Sources/Wiki), `llm_usage`.

Esquemas detalhados ficam para o plano de implementação, fase a fase.

## 9. Segurança, erros e testes

- **Acesso**: whitelist de `chat_id`s; secrets em `.env` (fora do git); RLS;
  escopos mínimos no Google; Banco MCP read-only.
- **Erros**: retry nos jobs; se uma integração falhar repetidamente, aviso no
  privado do Luis ("não consegui puxar o banco hoje"); logs estruturados.
- **Testes**: vitest nas regras de negócio (recall/upsert de memória,
  julgamento de proatividade com casos fixos, categorização, guarda de custo,
  parser de captura) com LLM mockado; smoke test E2E antes de deploy.

## 10. Fases de implementação

1. **Fundação + cérebro** — scaffold, Supabase+pgvector, bot com whitelist,
   agente com memória (3 camadas), roteador de modelos, `llm_usage` + guarda,
   reflexão noturna. *Critério: conversar hoje e ele lembrar amanhã.*
2. **Tarefas + agenda + compras** — paridade essencial com a v1, conversa
   natural; esposa entra aqui.
3. **Finanças** — Banco MCP, categorização com confirmação, metas,
   compromissos, revisão diária no chat.
4. **Proatividade** — coletores + julgamento + regras de silêncio +
   **briefing matinal unificado**.
5. **Gmail** — triagem, resumos, busca, captura de artigos (entrada do §6).
6. **Segundo cérebro** — vault + Syncthing + bibliotecário + consulta.
7. **Hábitos + projetos** — check-ins, tendências, acompanhamento.
8. **Web app** — dashboard completo + configurações + memórias + custo.
9. **Virada** — paralelo com a v1, ajustes, desligamento da v1.

Cada fase termina com algo usável no Telegram.

## 11. Fora de escopo (por ora)

Migração de dados da v1; WhatsApp e outros canais; envio de e-mail pelo
assistente; voz; integração de Projetos com repositórios/git; contas Google da
esposa (calendar dela via agenda compartilhada, como na v1); multi-tenant além
do casal.
