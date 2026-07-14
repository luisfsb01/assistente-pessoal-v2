# Setup v2 (fazer uma vez)

A v2 usa o **mesmo projeto Supabase da v1** e o **mesmo bot do Telegram**.
Pré-requisito: a v1 precisa ser desligada no VPS antes de ligar a v2
(`docker compose down` na pasta da v1 — dois processos não podem fazer long
polling com o mesmo token).

## 1. Banco de dados (SQL Editor do Supabase)

Rodar **em ordem**:
1. `supabase/migrations/0000_v1_cleanup.sql` — remove as tabelas do bot da v1
   (mantém finanças/categorias/objetivos/regras e as contas de login) e deixa
   só as transações de junho/2026.
2. `supabase/migrations/0001_init.sql` — cria as tabelas da v2 (memórias com
   pgvector, histórico, custo de LLM).

## 2. Cadastrar usuários e chats (SQL Editor)

Os chat_ids reais estão em SETUP.local.md (fora do git; já inseridos no banco em 2026-07-10 — este passo só é necessário se recriar o banco):

```sql
insert into users (name, subject, telegram_chat_id) values
  ('Luis', 'luis', SEU_CHAT_ID_LUIS),
  ('Esposa', 'esposa', CHAT_ID_ESPOSA);

insert into chats (id, kind, user_id) values
  (SEU_CHAT_ID_LUIS, 'private', (select id from users where subject = 'luis')),
  (CHAT_ID_ESPOSA, 'private', (select id from users where subject = 'esposa')),
  (CHAT_ID_GRUPO, 'group', null);
```

## 3. `.env`

Já preenchido neste repositório (token do bot da v1, chave OpenAI, mesmo
Supabase). Conferir apenas se `LLM_BUDGET_BRL` e os modelos estão como quer.

```
BANCO_MCP_TOKEN=            # token do Banco MCP (app.mcp.ai/agent-auth?toolkit=tk_pub_openfinance); vazio desliga a importação bancária
```

## 4. Validar localmente

1. Desligar a v1 no VPS.
2. `npm install && npm run dev` — o bot sobe em long polling.
3. `/id` deve responder; conversa no seu privado deve funcionar e criar
   memórias (`select * from memories`).
4. `npm run job:reflect` roda a reflexão manualmente.

## 5. Fase 2 (agendas e compras)

A Fase 2 adiciona suporte a duas pessoas (você e a esposa), agendas do Google
Calendar e lista de compras compartilhada. Execute **após** a Fase 1 estar
validada no VPS.

1. **Rodar migração do banco** (SQL Editor do Supabase):
   - Executar `supabase/migrations/0002_fase2.sql`.

2. **Ativar credenciais do Google** (local):
   - No `.env` local, descomentar as 3 linhas:
     ```
     GOOGLE_CLIENT_ID=...
     GOOGLE_CLIENT_SECRET=...
     GOOGLE_REFRESH_TOKEN=...
     ```
     (Os valores da v1 já estão no arquivo, comentados.)

3. **Mapear agendas do Google Calendar**:
   - Rodar `npm run google:calendars` e **anotar o ID da agenda "Esposa"**.

4. **Atualizar IDs das agendas no banco** (SQL Editor):
   ```sql
   update users set calendar_id = 'primary' where subject = 'luis';
   update users set calendar_id = 'ID_DA_AGENDA_ESPOSA' where subject = 'esposa';
   ```
   (Substituir `ID_DA_AGENDA_ESPOSA` pelo ID da agenda anotado no passo 3.)

5. **Deploy no VPS**:
   - Copiar as **3 variáveis Google** (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
     GOOGLE_REFRESH_TOKEN) para o arquivo `.env` do VPS.
   - Rodar: `FORCE=1 bash scripts/deploy-pull.sh`.

## Notas

- O web app da v1 sai do ar junto com a v1; ele volta servido pela v2
  (Fase 1.5) usando as mesmas tabelas de finanças e as mesmas contas de login.
- Backup das transações de junho + categorias: `data/v1-export/`.
- Credenciais do Google (agenda) e do Banco MCP estão comentadas no `.env`
  para as fases 2-3.
