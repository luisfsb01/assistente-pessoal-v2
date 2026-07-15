# Fase 5 — Gmail: limpeza automática da caixa + briefing

**Data:** 2026-07-15 · **Status:** aprovado no brainstorm (opção A)

## 1. Problema e escopo

O problema real do Luis com e-mail não é redigir nem buscar: é **volume de
e-mails inúteis** soterrando os úteis. A Fase 5 ataca isso:

- **Limpeza automática**: IA classifica os e-mails novos do INBOX; os
  claramente inúteis vão para a **lixeira do Gmail** (recuperáveis por 30
  dias). Na dúvida, o e-mail **fica**.
- **Briefing matinal**: ganha os **e-mails importantes** das últimas 24h e o
  **relatório da limpeza** ("joguei fora 14: 8 promoções, 6 newsletters").

**Fora de escopo** (revisto no brainstorm de 2026-07-15, difere da spec
original): alertas imediatos de e-mail importante (Luis não quer interrupção
por e-mail), busca/resumo no chat, rascunhos (Luis quase não envia e-mail),
captura de artigos (nasce com o vault na Fase 6), conta da esposa (sempre fora).

## 2. Arquitetura (opção A aprovada)

Job de limpeza standalone que grava o resultado na `event_queue` da F4 —
**sem** passar pelo julgamento (a classificação da limpeza já é o julgamento;
uma segunda chamada de IA seria redundante).

```
cron ~30min → jobs/email-cleanup.ts
  1. lista e-mails novos do INBOX desde o último check (app_state)
  2. classifica em LOTE (modelo default, purpose 'judgment', + memórias):
       lixo       → users.messages.trash + evento ignorado (auditoria)
       importante → evento queued/briefing/luis (cai no briefing da F4)
       normal     → não faz nada (fica na caixa, sem evento)
  3. salva o novo estado

briefing 07:00 (existente)
  - e-mails importantes: já entram de graça (eventos queued da fila)
  - relatório da limpeza: consulta agregada dos eventos de lixeira das
    últimas 24h (contagem + principais remetentes)
```

## 3. Componentes

| Unidade | Responsabilidade |
|---|---|
| `lib/google.ts` | + `getGmailClient(cfg)` (googleapis `gmail v1`, mesmo OAuth2/refresh token) |
| `lib/gmail.ts` (novo) | wrapper fino da API: listar mensagens novas do INBOX (com from/subject/snippet/labels/internalDate), mover para a lixeira |
| `jobs/email-cleanup.ts` (novo) | o ciclo do §2; deps injetáveis (`defaultDeps`), lógica pura testável |
| `db/events.ts` | + consulta agregada de eventos por kind desde um instante (para o relatório) |
| `jobs/briefing.ts` | + seção "limpeza do e-mail" no prompt do briefing do Luis |
| `jobs/scheduler.ts` | + cron da limpeza (30 em 30 min, só se `hasGoogleCreds`) |
| `supabase/migrations/0004_fase5.sql` | `event_queue.source` passa a aceitar `'gmail'` (altera o CHECK) |

## 4. Decisões de design

- **Estado do cursor**: `app_state['gmail_cleanup_state'] = { lastInternalDate }`
  (epoch ms do e-mail mais novo processado). A cada rodada, busca
  `in:inbox` com `after:` desse instante e processa só o que é mais novo.
  Primeira execução: só salva o cursor (agora), não classifica nada — evita
  avalanche na caixa acumulada.
- **Classificação em lote**: uma chamada por rodada (pula a IA se não há
  e-mail novo). Entrada por e-mail: remetente, assunto, snippet (~200 chars) e
  categoria do próprio Gmail (`CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`...)
  como sinal. Saída por id: `lixo | importante | normal` + motivo curto em
  PT-BR. Memórias relevantes entram no prompt (ex.: "nunca jogar fora e-mails
  da escola") — corrigir a limpeza é conversa: vira memória, a IA respeita.
- **Regras duras (não dependem da IA)**: e-mail com estrela (`STARRED`) nunca
  vai para a lixeira; falha na IA = ninguém vai para a lixeira (degrada para
  "normal"); id que a IA não devolveu = normal.
- **Auditoria**: todo e-mail jogado fora vira evento
  `source='gmail'`, `kind='email_trashed'`, dedupe `gmail:trash:<msgId>`,
  `decision='ignore'`, `status='ignored'`, `reason` = motivo da IA — fica no
  banco para auditoria/relatório, mas NÃO polui o prompt do briefing (que
  recebe só o agregado). Importantes: `kind='email_important'`, dedupe
  `gmail:important:<msgId>`, `decision='briefing'`, `status='queued'` —
  entram no briefing pelo fluxo existente e são marcados `briefed`.
- **Desfazer**: o relatório cita os remetentes; recuperação é na lixeira do
  próprio Gmail (30 dias). Sem botão de undo nesta fase.
- **Sem config nova**: cadência e limites hard-coded; ajustes finos ficam
  para a UI da Fase 8.

## 5. Operacional (OAuth)

O refresh token atual só tem escopo de Calendar. É preciso gerar um novo com
`calendar` + `gmail.modify` (leitura + labels + lixeira; **não** permite
apagar em definitivo nem enviar) e atualizar `GOOGLE_REFRESH_TOKEN` no `.env`
local e no do VPS. Passo a passo no SETUP.md (mesmo caminho usado na Fase 2).
Sem o escopo novo, a limpeza loga o erro e não faz nada — os crons de
calendário continuam funcionando.

## 6. Erros e custo

- Try/catch por rodada; erro em um e-mail (ex.: trash falhou) não derruba a
  rodada; erro na IA = rodada sem lixeira (conservador).
- Custo: ~48 rodadas/dia, mas a IA só roda quando há e-mail novo; lote com
  modelo default (mesmo perfil barato do julgamento da F4). Impacto estimado
  bem abaixo do teto de R$ 50/mês.

## 7. Testes

Padrão da F4: deps fakes injetadas (nunca rede), vitest da raiz,
`import '../test-setup.js'` primeiro. Casos-chave: primeira execução só salva
cursor; STARRED nunca vai à lixeira; falha da IA degrada para normal; dedupe
não duplica evento; relatório agrega por remetente; briefing inclui a seção
só quando houve limpeza.

## 8. Critério de aceite (UAT)

Depois de 1 dia rodando: caixa de entrada visivelmente mais limpa, nenhum
e-mail útil na lixeira, briefing das 07:00 com a seção da limpeza e os
importantes do dia anterior. `event_queue` com motivo preenchido em cada
e-mail jogado fora.
