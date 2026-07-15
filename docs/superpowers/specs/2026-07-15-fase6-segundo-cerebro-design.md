# Fase 6 — Segundo cérebro: vault + captura + bibliotecário + consulta

**Data:** 2026-07-15 · **Status:** aprovado no brainstorm (opção A)

## 1. Problema e escopo

Luis quer guardar conteúdo bom (artigos, vídeos, podcasts) num lugar que
acumula conhecimento navegável — não numa lista de links morta. Método LLM
Wiki (Karpathy): fontes imutáveis + wiki viva mantida pelo agente.

**Entra na fase:**
- **Captura por link no chat**: Luis manda a URL (+ nota opcional), o bot
  extrai o conteúdo, grava em `Sources/` e responde com um resumo curto.
  Tipos: artigo web (modo leitura), YouTube (título/descrição/transcrição
  quando houver) e link+nota (podcasts e qualquer URL em que a extração
  falhe — a nota do Luis vira o corpo).
- **Bibliotecário**: job noturno, modelo default (barato), processa SÓ as
  fontes novas; cria/atualiza páginas do `Wiki/` com `[[links]]`, mantém
  `Index.md`. Sources nunca são modificadas.
- **Consulta**: tool `knowledge_search` — pgvector sobre chunks de
  Sources+Wiki (tabela `knowledge_index`, migração 0005); as respostas do
  agente citam as notas pelo nome.
- **Sync**: Syncthing VPS ↔ PC Windows ↔ celular (Obsidian desktop/mobile).
  Setup manual documentado no SETUP.md em passo a passo leigo.

**Fora da fase** (revisto no brainstorm de 2026-07-15): captura por label do
Gmail (fica no backlog — o encanamento da F5 facilita adicionar depois),
"encaminhar e-mail para o bot" (ambíguo, descartado), PDFs, integração com
Projetos (F7), UI web do conhecimento (F8).

## 2. Arquitetura (opção A aprovada)

Vault de **arquivos markdown como fonte da verdade**, numa pasta do host do
VPS montada no container (bind mount) — o Syncthing roda no host e sincroniza
exatamente o que o bot escreve. O índice semântico (`knowledge_index`,
pgvector) é um **espelho derivado** dos arquivos: pode ser reconstruído a
qualquer momento; nunca é a fonte.

```
vault/                        (host: ~/assistente-vault → container: /vault)
├── Sources/                  # imutáveis, uma nota por captura
│   └── 2026-07-15-titulo-slug.md   (frontmatter: title, url, origem,
│                                    captured_at, tags, note do Luis)
└── Wiki/                     # do bibliotecário
    ├── Index.md              # índice navegável
    └── <Conceito>.md         # páginas com [[links]] entre si

Fluxo de captura (síncrono, no chat):
  link (+nota) → tool knowledge_save → extração → Sources/*.md
    → chunks + embeddings em knowledge_index → resumo curto na resposta

Fluxo do bibliotecário (cron noturno, 04:00):
  fontes novas (não processadas) → para cada uma: decidir páginas do Wiki
  afetadas → criar/atualizar páginas + Index.md → reindexar o que mudou
  → marcar fonte como processada (estado em app_state)

Fluxo de consulta:
  pergunta → tool knowledge_search → embedding da query → top-k chunks
  → resposta do agente citando as notas ("segundo [[Nome da nota]]…")
```

## 3. Componentes

| Unidade | Responsabilidade |
|---|---|
| `lib/config.ts` | + `VAULT_PATH` (default `./data/vault` local; `/vault` no container) |
| `knowledge/vault.ts` (novo) | caminhos, slugs, frontmatter, ler/escrever/listar notas de Sources e Wiki (única camada que toca o filesystem do vault) |
| `knowledge/extract.ts` (novo) | URL → `{ kind: 'article'\|'youtube'\|'link'; title; markdown }` — readability+turndown para artigos; oEmbed+legendas para YouTube; fallback link+nota |
| `knowledge/indexer.ts` (novo) | chunking dos .md, embeddings (purpose `embedding` existente), upsert/remoção em `knowledge_index` por arquivo |
| `tools/knowledge.ts` (novo) | tools do agente: `knowledge_save(url, note?)` e `knowledge_search(query)` |
| `jobs/librarian.ts` (novo) | job noturno do bibliotecário (modelo default), estado de processados em `app_state` |
| `jobs/scheduler.ts` | + cron `0 4 * * *` (não colide: reflexão 03:00, tarefas 06:30, briefing 07:00) |
| `supabase/migrations/0005_fase6.sql` | tabela `knowledge_index` (path, chunk_no, content, embedding vector, hash, updated_at) + índice pgvector + função de busca |
| `docker-stack.yml`/`docker-compose.yml` | bind mount do vault + env `VAULT_PATH` |
| `SETUP.md` §8 | migração 0005, pasta do vault no VPS, Syncthing leigo (instalar nos 3 aparelhos, parear, compartilhar a pasta), Obsidian desktop/mobile apontando para a pasta |

## 4. Decisões de design

- **Idioma**: páginas do Wiki e resumos em PT-BR; trechos citados ficam no
  idioma original da fonte.
- **Sources imutáveis**: capturou, congelou. Correção = capturar de novo
  (gera nota nova); o bibliotecário nunca edita `Sources/`.
- **Nome de arquivo**: `YYYY-MM-DD-<slug-do-titulo>.md` em Sources (estável,
  legível, sem colisão prática); Wiki usa o nome do conceito
  (`Prompt Engineering.md`) para os `[[links]]` do Obsidian funcionarem.
- **Extração**: melhor esforço com timeout curto; se a página resistir
  (paywall, JS pesado) ou o tipo não for suportado, degrada para link+nota
  e avisa no chat ("salvei só o link e a sua nota — não consegui extrair").
  Nunca falha a captura por causa da extração.
- **YouTube**: título/autor via oEmbed (sem chave de API); transcrição via
  legendas públicas quando existirem; sem legenda = título + descrição do
  Luis. Nada de API key nova.
- **Bibliotecário incremental**: processa no máx. 5 fontes novas por noite
  (proteção de custo); wiki é atualizada com o modelo default; toda página
  criada/alterada é reindexada na mesma rodada. Estado (lista de fontes
  processadas) em `app_state['librarian_state']`.
- **Índice reconstruível**: `knowledge_index` guarda `hash` do chunk;
  reindexar um arquivo = apagar os chunks daquele `path` e regravar. Script
  manual de reindex total para recuperação (`job:reindex-vault`).
- **Sem Syncthing no container**: Syncthing é serviço do host (systemd),
  sincronizando `~/assistente-vault`. O container só vê o bind mount.
  Conflitos do Syncthing (`*.sync-conflict*`) são ignorados pelo indexer.
- **Segurança**: o bot só escreve dentro de `VAULT_PATH`; paths sempre
  derivados de slug (nunca de input cru do usuário).

## 5. Erros e custo

- Extração e indexação com try/catch: falha de embedding não perde a nota
  (o arquivo é a verdade; o índice se reconstrói). Falha do bibliotecário
  numa fonte não trava as outras; fonte problemática fica para a próxima
  noite.
- Custo: embeddings são baratos; bibliotecário roda no modelo default com
  teto de fontes/noite; captura é 1 chamada de resumo curto. Dentro do teto
  de R$ 50/mês com folga.

## 6. Testes

Padrão do projeto: deps fakes injetadas (filesystem em pasta temporária nos
testes do vault; nunca rede), vitest da raiz, `test-setup` quando tocar
`db/client.ts`. Casos-chave: slug/frontmatter estáveis; extração degrada
para link+nota; captura responde resumo e indexa; bibliotecário processa só
o novo e respeita o teto; `knowledge_search` cita a nota certa; indexer
ignora `sync-conflict`; reindex apaga antes de regravar.

## 7. Critério de aceite (UAT)

1. Mandar um link de artigo no chat → resposta com resumo em segundos; nota
   aparece em `Sources/` no Obsidian do PC (via Syncthing) e no celular.
2. Na manhã seguinte: páginas novas no `Wiki/` com `[[links]]` e `Index.md`
   atualizado, citando a fonte.
3. Perguntar algo sobre o artigo no chat → resposta cita a nota pelo nome.
4. Link de podcast com nota → salvo como link+nota sem erro.
