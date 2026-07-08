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
```sql
insert into users (name, subject, telegram_chat_id) values
  ('Luis', 'luis', SEU_CHAT_ID),
  ('Esposa', 'esposa', CHAT_ID_DELA);

insert into chats (id, kind, user_id) values
  (SEU_CHAT_ID, 'private', (select id from users where subject = 'luis')),
  (CHAT_ID_DELA, 'private', (select id from users where subject = 'esposa')),
  (CHAT_ID_DO_GRUPO, 'group', null);
```
