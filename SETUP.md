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

## 6. Fase 4 (proatividade + briefing)

1. **Migração**: executar `supabase/migrations/0003_fase4.sql` (SQL Editor ou Management API).
2. Nada novo no `.env` — os coletores usam as credenciais já existentes (Google/Banco MCP); sem elas, o coletor correspondente fica desligado.
3. Regras de respeito: silêncio 22:00–07:00 e máx. 5 notificações/dia por pessoa (defaults; ajustáveis na chave `proactivity_config` do `app_state` até a UI da Fase 8).
4. Testes manuais: `npm run job:proactive -w apps/server` (um ciclo de coleta+julgamento+entrega) e `npm run job:briefing -w apps/server` (briefing na hora).

## 7. Fase 5 (limpeza do Gmail + briefing)

1. **Migração**: executar `supabase/migrations/0004_fase5.sql` (SQL Editor ou Management API).
2. **Novo refresh token** (o atual só tem permissão de Agenda; precisamos de
   um novo que tenha Agenda **e** Gmail — passo a passo abaixo).

   *O que é isso?* O bot acessa seu Google com uma "chave" (o refresh token).
   A chave atual só abre o Calendar. Vamos gerar uma chave nova que abre
   Calendar + Gmail. A antiga continua funcionando enquanto você não troca.

   **a) Ligar a Gmail API no projeto** (sem isso, tudo dá erro depois):
   1. Abra [console.cloud.google.com](https://console.cloud.google.com) logado
      como `luisfelipesb@gmail.com` e confira, no topo da página, se o projeto
      selecionado é o mesmo do bot (o mesmo usado para o Calendar na Fase 2).
   2. Menu ☰ → **APIs e serviços** → **Biblioteca**.
   3. Busque **Gmail API** → clique nela → botão **Ativar** (se já aparecer
      "Gerenciar", já está ativa — pode seguir).

   **b) Conferir duas coisas na tela de credenciais:**
   1. Menu ☰ → **APIs e serviços** → **Credenciais**.
   2. Na lista "IDs do cliente OAuth 2.0", clique no nome do client (o lápis
      de editar). Na seção **URIs de redirecionamento autorizados**, veja se
      existe a linha `https://developers.google.com/oauthplayground`.
      Se não existir: **+ Adicionar URI**, cole exatamente isso e **Salvar**.
   3. Ainda em APIs e serviços → **Tela de permissão OAuth**: se o "Status de
      publicação" estiver **Em teste**, clique em **Publicar app**. (Em modo
      teste, a chave nova expiraria sozinha em 7 dias.)

   **c) Gerar a chave nova no OAuth Playground:**
   1. Abra o arquivo `.env` na raiz deste projeto (pode ser no Bloco de
      Notas) e deixe à mão os valores de `GOOGLE_CLIENT_ID` e
      `GOOGLE_CLIENT_SECRET` (copie sem espaços).
   2. Abra [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
   3. Clique na **engrenagem ⚙️** (canto superior direito) → marque
      **Use your own OAuth credentials** → cole o CLIENT_ID em
      "OAuth Client ID" e o SECRET em "OAuth Client secret" → feche o painel.
   4. No lado esquerdo (Step 1), IGNORE a lista de APIs: no campo de texto
      embaixo dela ("Input your own scopes"), cole esta linha inteira
      (são os dois escopos separados por UM espaço):
      `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify`
   5. Clique em **Authorize APIs**. Vai abrir a tela de login do Google:
      escolha a conta `luisfelipesb@gmail.com`.
   6. Se aparecer o aviso "O Google não verificou este app": clique em
      **Avançado** → **Acessar ... (não seguro)**. É o SEU próprio app,
      pode confiar.
   7. Autorize as permissões pedidas (Agenda + Gmail) → **Continuar**.
   8. De volta ao Playground (Step 2), clique em
      **Exchange authorization code for tokens**.
   9. No painel da direita aparece um texto tipo JSON. Copie SÓ o valor de
      `"refresh_token"` — a sequência longa entre aspas, geralmente começa
      com `1//` (copie sem as aspas).

   **d) Trocar a chave nos dois `.env`:**
   1. **Local**: no `.env` da raiz do projeto, troque o valor da linha
      `GOOGLE_REFRESH_TOKEN=` pelo token copiado. Salve.
   2. **VPS**: no terminal do navegador da Hostinger, edite o `.env` do app
      (mesmo arquivo onde estão as outras variáveis) e troque a mesma linha.
   3. Reinicie o serviço no VPS (ou espere o próximo deploy) para ele ler o
      valor novo.

   *Segurança*: o escopo `gmail.modify` NÃO permite apagar e-mail em
   definitivo nem enviar e-mail — o pior que o bot consegue fazer é mover
   para a lixeira (recuperável por 30 dias). O Calendar continua funcionando
   normalmente com a chave nova.
3. **Primeira execução**: `npm run job:email-cleanup -w apps/server` — só
   salva o cursor (não mexe na caixa acumulada). Da segunda em diante,
   classifica o que chegou de novo.
4. Corrigir a limpeza é conversa: "não jogue fora e-mails da escola" vira
   memória e a IA respeita. Recuperar e-mail: lixeira do Gmail (30 dias).

## 8. Fase 6 (segundo cérebro: vault + Syncthing + Obsidian)

1. **Migração**: executar `supabase/migrations/0005_fase6.sql` (SQL Editor ou
   Management API).
2. **Pasta do vault no VPS** (terminal do navegador da Hostinger):
   ```bash
   mkdir -p /root/assistente-vault
   ```
   O deploy monta essa pasta dentro do container como `/vault`
   (variável `VAULT_PATH`). Nada a configurar no `.env` do VPS.
3. **Testar a captura**: mandar um link de artigo no chat do bot pedindo para
   salvar → a nota aparece em `/root/assistente-vault/Sources/`. O
   bibliotecário roda às 04:00 (ou `npm run job:librarian -w apps/server`).
4. **Syncthing** (espelha o vault no PC e no celular — passo a passo leigo):

   *O que é:* um programa que mantém a MESMA pasta igualzinha em vários
   aparelhos, direto entre eles (sem nuvem de terceiros).

   **a) No VPS:**
   ```bash
   apt install -y syncthing
   systemctl enable --now syncthing@root
   # liberar a GUI só para configurar (senha primeiro!):
   syncthing cli config gui raw-address set 0.0.0.0:8384
   systemctl restart syncthing@root
   ```
   - No painel de firewall da Hostinger, liberar as portas **8384** (TCP,
     temporária, só para configurar) e **22000** (TCP e UDP, permanente).
   - Abrir `http://IP-DO-VPS:8384` no navegador → Actions → Settings → GUI →
     definir **usuário e senha** (obrigatório antes de qualquer outra coisa).
   - Actions → Show ID → esse é o **Device ID do VPS** (um QR/código longo).
   - Add Folder: Folder Path `/root/assistente-vault`, Label `vault`.
5. **No PC (Windows)**: instalar o [Syncthing](https://syncthing.net/downloads/)
   (ou SyncTrayzor). Abrir a GUI local → Add Remote Device → colar o Device
   ID do VPS → no VPS, aceitar o convite e **compartilhar a pasta `vault`**
   com o PC → no PC, aceitar a pasta e escolher um caminho (ex.:
   `C:\Users\LUIS BARBOSA\assistente-vault`).
6. **No celular**: Android → app "Syncthing-Fork" (Play Store); iPhone →
   "Möbius Sync" (App Store). Mesmo processo: parear com o Device ID do VPS
   e aceitar a pasta `vault`.
7. **Obsidian**: instalar no PC/celular e "Open folder as vault" apontando
   para a pasta sincronizada. `Sources/` = capturas; `Wiki/` = páginas do
   bibliotecário; comece por `Wiki/Index.md`.
8. Depois de tudo pareado, **fechar a porta 8384** no firewall (a GUI volta
   a ser local); a 22000 fica aberta (é a porta de sincronização).
9. **Recuperação do índice** (se precisar): `npm run job:reindex-vault -w apps/server`
   reconstrói a busca a partir dos arquivos.

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

## 10. Fase 8 (web app: controle do assistente)

1. **Migração**: executar `supabase/migrations/0007_fase8.sql` (SQL Editor ou
   Management API) — policies de RLS para o web + função `month_cost_by_purpose`. Antes de aplicar, confirmar no painel do Supabase (Authentication → Sign In / Up) que novos cadastros estão desabilitados — as policies dão acesso total a qualquer conta autenticada.
2. Nada novo no `.env`.
3. No web app: páginas novas Tarefas, Compras, Hábitos, Projetos e Memórias;
   em Configurações, o assistente (silêncio, teto, horário e liga/desliga das
   rotinas — mudança vale no minuto seguinte) e o custo de IA do mês vs teto.
4. Os horários das rotinas saem de `app_state.routines_config` (defaults:
   briefing 07:00, casal sáb 08:00, revisão financeira 08:00, check-in 21:00).

## Notas

- O web app da v1 sai do ar junto com a v1; ele volta servido pela v2
  (Fase 1.5) usando as mesmas tabelas de finanças e as mesmas contas de login.
- Backup das transações de junho + categorias: `data/v1-export/`.
- Credenciais do Google (agenda) e do Banco MCP estão comentadas no `.env`
  para as fases 2-3.
