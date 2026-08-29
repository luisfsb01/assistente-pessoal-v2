---
status: resolved
trigger: "A rotina financeira não está satisfatória: no Hermes os botões de confirmar das transações aparecem juntos no final e, ao confirmar a primeira, todos os demais somem."
created: 2026-08-26T20:31:51.8224598-03:00
updated: 2026-08-29T12:22:00-03:00
---

## Current Focus

hypothesis: Confirmada: o V2 atualizado emitia os botões individuais, mas o adapter do processo Hermes na VPS ainda não continha o handler APV2_FINANCE_CALLBACK_BEGIN.
test: Aplicar o ativador no Python real do Hermes, reiniciar o gateway de usuário e confirmar transações por dois botões no Telegram.
expecting: Cada toque confirma a transação correspondente e mantém os demais botões utilizáveis.
next_action: Nenhuma para a regressão financeira; a remoção do serviço systemd antigo e inoperante é uma limpeza operacional separada.

## Symptoms

expected: Para cada transação, enviar uma mensagem independente contendo os dados da transação e seu próprio botão Confirmar correspondente logo abaixo. Confirmar um item não afeta os outros.
actual: O Hermes envia as 15 mensagens de gastos sem botões individuais e depois envia "Confirme as sugestões com um toque:" com cerca de 15 botões juntos. Ao clicar no primeiro, todos os outros desaparecem e não voltam.
errors: Não há erro explícito. A confirmação A160 é processada e verificada no banco, mas o teclado coletivo desaparece.
reproduction: Executar a rotina/resumo diário com gastos pendentes; observar a lista de até 15 transações e o bloco final de botões; clicar em "✅ Confirmar A160".
started: Funcionava antes da migração para Hermes; regrediu após a migração.

## Eliminated

- hypothesis: O conector Telegram do Hermes já encaminha callback_data arbitrário de InlineKeyboard ao agente como mensagem normal.
  evidence: A fonte/documentação oficial mostra que _handle_callback_query aceita apenas prefixos internos específicos; a solicitação oficial de suporte a ações inline genéricas continua aberta e explica que um processo externo não pode receber os cliques enquanto o Hermes detém o polling.
  timestamp: 2026-08-26T20:52:30-03:00

## Evidence

- timestamp: 2026-08-26T20:34:20-03:00
  checked: Busca global por textos da saída real e inventário de testes.
  found: Os textos exatos da conversa não estão codificados literalmente; existem testes dedicados para finance-review, telegram-delivery e callback. O worktree já contém apenas arquivos de debug não rastreados de outras investigações, que devem ser preservados.
  implication: O conteúdo provavelmente é produzido dinamicamente por prompt/Hermes, e a investigação deve seguir o contrato estruturado de entrega e callback, sem tocar nos demais arquivos de debug.

- timestamp: 2026-08-26T20:38:10-03:00
  checked: Implementação integral de finance-review, telegram-delivery e codec de callback, com seus testes.
  found: No modo buttons, cada transação recebe InlineKeyboard próprio com callback fin:ok:<txId>. No modo hermes, cada mensagem é enviada sem reply_markup, as referências são acumuladas em hermesReferences e buildHermesFinanceButtons cria um único Keyboard resized().oneTime(), enviado na mensagem final "Confirme as sugestões com um toque:".
  implication: A agregação e o desaparecimento conjunto não são acidentais do Telegram; são consequência direta da implementação do modo Hermes e estão inclusive cristalizados no teste unitário atual.

- timestamp: 2026-08-26T20:38:10-03:00
  checked: Semântica do teclado montado pelo código.
  found: buildHermesFinanceButtons retorna um ReplyKeyboardMarkup com one_time_keyboard=true, não um InlineKeyboardMarkup anexado individualmente.
  implication: O teclado é global para a conversa e solicitado para ocultar após um uso; confirmar A160 necessariamente faz desaparecer todos os botões que compartilham esse teclado.

- timestamp: 2026-08-26T20:41:15-03:00
  checked: Histórico e blame de finance-review, mais todos os usos de interactionMode e tipos de teclado.
  found: A agregação atual foi introduzida integralmente pelo commit 083a981 "feat: restaurar botoes de confirmacao no Hermes", posterior ao commit 3f2320d "feat: migrar rotinas do Telegram para Hermes". Os demais jobs Hermes também usam Keyboard de texto, enquanto o modo antigo usa InlineKeyboard com callback_data.
  implication: A regressão é uma decisão localizada e recente na restauração de botões do finance-review, não uma falha genérica do envio Telegram. O desenho de correção precisa respeitar o roteamento de respostas por texto do Hermes.

- timestamp: 2026-08-26T20:45:00-03:00
  checked: Patches integrais dos commits de migração e restauração, bootstrap atual e outros jobs interativos.
  found: O V2 cria o cliente do token Hermes apenas para sendMessage e comenta explicitamente que o Hermes mantém o long polling. Na migração, callbacks inline foram removidos do modo Hermes em todos os jobs e substituídos inicialmente por instruções textuais; depois alguns jobs passaram a usar ReplyKeyboard para gerar uma mensagem de usuário interpretável pelo agente.
  implication: Reusar encodeFinAction no bot Hermes sem confirmar suporte do conector faria o clique ser recebido exclusivamente pelo polling do Hermes, não pelo handler do V2. A investigação deve validar o comportamento do conector antes da mudança.

- timestamp: 2026-08-26T20:45:00-03:00
  checked: Contraste entre requisito e tipos nativos do Telegram.
  found: ReplyKeyboard é um teclado de conversa substituível, enquanto InlineKeyboard pertence à mensagem. A implementação atual usa oneTime justamente para ocultar o teclado depois do primeiro envio de texto.
  implication: Não existe ajuste de linhas/oneTime no ReplyKeyboard capaz de fazer quinze teclados independentes coexistirem sob quinze mensagens; a solução real precisa voltar a InlineKeyboard e tratar seus callbacks no caminho Hermes.

- timestamp: 2026-08-26T20:52:30-03:00
  checked: Código e issues oficiais do NousResearch/hermes-agent para callback_query e ações genéricas.
  found: O Hermes possui inline keyboards somente para fluxos internos com prefixos conhecidos (modelo, aprovação, clarify etc.). A issue oficial de ações genéricas documenta explicitamente que ReplyKeyboard não é contextual nem anexado à mensagem e que callbacks arbitrários precisam ser tratados dentro do gateway que possui o polling.
  implication: A solução não pode se limitar ao finance-review.ts. Ela precisa adicionar no Hermes um roteamento deliberado para o prefixo financeiro, ou os botões inline não executarão a confirmação.

- timestamp: 2026-08-26T20:58:10-03:00
  checked: Script de ativação Hermes, skill operacional e handoff da migração.
  found: activate-hermes-telegram.sh já é o ponto versionado que copia a skill, altera configuração com backup/rollback, faz deploy do V2 e reinicia o gateway. A decisão arquitetural exige que Hermes permaneça como interface única e dono do polling.
  implication: Uma extensão do próprio gateway instalada por esse script respeita a arquitetura; reativar o bot antigo ou iniciar um segundo polling contraria decisão explícita e não deve ser usado.

- timestamp: 2026-08-26T21:08:00-03:00
  checked: Adapter Telegram oficial do Hermes no commit 77001a6 (26/08/2026), incluindo registro de handlers, _handle_callback_query, _handle_text_message, _build_message_event e _enqueue_text_event.
  found: O CallbackQueryHandler é registrado uma vez para _handle_callback_query; callbacks desconhecidos retornam sem despacho. Mensagens normais viram MessageEvent e são entregues por handle_message/_enqueue_text_event. O adapter já expõe build_source, MessageEvent, MessageType e _is_callback_user_authorized, suficientes para um ramo financeiro pequeno sem novo consumidor de updates.
  implication: É tecnicamente viável converter apenas callbacks apv2:fin:<referência> em uma entrada textual autossuficiente no mesmo chat/sessão, reutilizando autorização e processamento existentes do Hermes.

- timestamp: 2026-08-26T21:18:00-03:00
  checked: Implementação do job, patcher do adapter e ativação Hermes.
  found: O modo Hermes agora anexa um InlineKeyboard novo a cada sendMessage de transação e não envia mais o bloco final agregado. O patcher adiciona callback apv2:fin com validação, autorização, remoção apenas do reply_markup clicado e despacho de MessageEvent ao agente. O ativador localiza o Python/adapter real do Hermes, cria backup, aplica o patch idempotente, roda py_compile e restaura no rollback.
  implication: A mudança cobre tanto a associação visual quanto o processamento do clique sem disputar o polling do Hermes; resta provar sintaxe e regressões por execução.

- timestamp: 2026-08-26T21:23:00-03:00
  checked: Typecheck do servidor e teste unitário do patcher.
  found: npm run typecheck concluiu sem erros; os 3 testes do patcher passaram. A tentativa de bash -n não executou porque bash não está no PATH desta máquina Windows.
  implication: Tipos e transformação pura estão válidos. A sintaxe bash ainda precisa de outro executável/validação; a falha observada é de disponibilidade da ferramenta, não do script.

- timestamp: 2026-08-26T21:28:30-03:00
  checked: Testes focados, patcher aplicado ao adapter oficial completo, idempotência, py_compile e bash -n via Git Bash.
  found: finance-review.test passou 4/4; hermes-finance-callback-patch.test passou 3/3; a primeira aplicação alterou o adapter e a segunda informou que já estava instalado; python -m py_compile retornou zero; Git Bash -n retornou zero.
  implication: O markup individual, a transformação do adapter, sua compatibilidade sintática real e o fluxo de ativação estão verificados. Falta apenas regressão ampla.

- timestamp: 2026-08-26T21:35:00-03:00
  checked: Suíte completa, build, node --check, git diff --check e busca por resquícios do teclado agregado.
  found: npm test passou 80 arquivos/426 testes; npm run build passou; node --check e git diff --check retornaram zero. A busca não encontrou mais buildHermesFinanceButtons nem a mensagem "Confirme as sugestões com um toque" no código.
  implication: Não há regressão local detectada e o caminho agregado foi removido. A única etapa não observável localmente é a interação real do gateway na VPS com o Telegram.

- timestamp: 2026-08-26T21:48:00-03:00
  checked: Implementações oficiais completas de _handle_reload_mcp_command, _execute_mcp_reload e CLI _reload_mcp no Hermes 77001a6.
  found: /reload-mcp exclusivamente encerra/reconecta servidores MCP, redescobre ferramentas e atualiza agentes em cache. Ele não reimporta plugins, não recria TelegramAdapter e não reinicia o processo Python.
  implication: A orientação anterior para usar /reload-mcp após falha do restart é incorreta e deixaria o novo callback ausente da memória até um restart real.

- timestamp: 2026-08-26T21:48:00-03:00
  checked: Ordem atual do script de ativação e semântica do rollback.
  found: O deploy do V2 ocorre antes do restart Hermes. Se o restart falhar e o trap restaurar o adapter antigo, o V2 novo permanecerá emitindo callbacks apv2:fin sem nenhum handler persistido para o próximo restart.
  implication: Depois que deploy-pull.sh termina, o rollback não pode mais remover o patch do adapter. A falha deve ser parcial, explícita e recuperável por restart manual, nunca um sucesso silencioso.

- timestamp: 2026-08-26T22:01:00-03:00
  checked: Implementação revisada do ativador e teste de integração local.
  found: O script agora marca DEPLOY_COMMITTED somente depois de deploy-pull.sh. Falhas anteriores restauram backups; falha posterior de restart mantém o adapter patchado/configuração, imprime recuperação manual, proíbe /reload-mcp e sai 1. O novo teste cria Hermes, adapter, config e deploy falsos para executar os caminhos de restart 0 e 1.
  implication: A regra de consistência está codificada e coberta por execução, pendente confirmar que o fixture funciona nos ambientes de teste.

- timestamp: 2026-08-26T22:07:00-03:00
  checked: Primeira execução do teste de integração do ativador.
  found: Os dois cenários pararam antes da ativação porque o fake hermes usava #!/usr/bin/env python3 e o alias python3 do Windows retornou permissão negada. bash -n continuou passando.
  implication: A falha não contradiz a lógica de restart; revelou que a descoberta por shebang precisa de override explícito para wrappers/ambientes não padrão. Foi adicionado HERMES_PYTHON opcional e o fixture agora usa o Python real.

- timestamp: 2026-08-26T22:13:00-03:00
  checked: Teste executável do activate-hermes-telegram.sh com gateway fake.
  found: Os 2 cenários passaram. Restart exit 0 concluiu e manteve o patch; restart exit 1 retornou não zero, omitiu "Migração concluída", informou que /reload-mcp não serve, manteve o patch em disco e exibiu o comando de restart real.
  implication: O risco apontado pela revisão está reproduzido e protegido por regressão automatizada.

- timestamp: 2026-08-26T22:21:00-03:00
  checked: Primeira bateria ampla após o endurecimento.
  found: Typecheck, build, bash -n, node --check e diff --check passaram. A suíte teve somente 2 falhas: os dois subprocessos de ativação excederam 30s quando executados simultaneamente com typecheck/build; isolados haviam levado 7s e 5s e passado.
  implication: Não é falha funcional, mas o teste estava sensível à contenção do Windows. O timeout foi elevado para 90s e a suíte será repetida isoladamente para eliminar a flutuação.

- timestamp: 2026-08-26T22:28:00-03:00
  checked: Suíte completa repetida isoladamente com o timeout subprocessual ajustado.
  found: npm test encerrou com código zero: 81 arquivos e 428 testes passaram. Os dois cenários de ativação/restart passaram dentro da suíte completa; nenhum processo de teste permaneceu ativo.
  implication: A flutuação por contenção foi eliminada e tanto a correção funcional quanto o comportamento fail-closed do deploy estão protegidos pela regressão ampla.

- timestamp: 2026-08-29T11:27:13-03:00
  checked: Verificação humana no Telegram após o commit 364c8f0.
  found: Os botões individuais "✅ Confirmar Axxx" aparecem sob as respectivas transações, mas tocar neles não produz resposta nem confirmação.
  implication: A entrega do InlineKeyboard pelo V2 está ativa; a falha está depois do clique, no recebimento/roteamento do callback pelo gateway Hermes ou no despacho ao agente.

- timestamp: 2026-08-29T11:27:13-03:00
  checked: Estado local do Git antes da retomada.
  found: master, HEAD e origin/master apontam para 364c8f0. Há mudanças locais somente na funcionalidade de viagens e arquivos de outras sessões de debug; nenhuma delas pertence ao patch financeiro.
  implication: O commit foi enviado ao remoto, mas isso não prova a ativação do adapter na VPS. As mudanças de viagens devem permanecer intocadas.

- timestamp: 2026-08-29T11:29:10-03:00
  checked: Busca por operações de deploy, Hermes e VPS no repositório.
  found: A ativação é centralizada em scripts/activate-hermes-telegram.sh; o deploy do serviço usa scripts/deploy-pull.sh; docs/hermes/INSTALACAO.md documenta a operação via terminal da Hostinger. Não apareceu host SSH versionado na busca inicial.
  implication: O script de ativação e a documentação precisam ser lidos integralmente antes de inferir o processo ativo ou executar qualquer ação remota.

- timestamp: 2026-08-29T11:32:40-03:00
  checked: Scripts integrais activate-hermes-telegram.sh, deploy-pull.sh, patch-hermes-finance-callback.mjs e guia Hermes.
  found: deploy-pull.sh atualiza/reinicia somente o serviço Docker V2. O patch do adapter e o restart real do gateway ocorrem exclusivamente em activate-hermes-telegram.sh. O cron documentado chama apenas deploy-pull.sh. O ativador resolve o adapter pelo mesmo Python do executável hermes, instala o marcador, compila e chama hermes gateway restart.
  implication: O sintoma é exatamente compatível com o commit ter chegado automaticamente ao V2 sem que a etapa manual de ativação do gateway tenha sido executada. Essa hipótese agora deve ser testada diretamente na VPS.

- timestamp: 2026-08-29T11:34:05-03:00
  checked: Git remote e metadados SSH locais.
  found: O remote Git é HTTPS do GitHub e não existe ~/.ssh/config nem inventário visível de chaves nesta conta.
  implication: Não há alvo SSH configurado que possa ser usado com segurança. O acesso versionado/documentado restante é o terminal da VPS no painel Hostinger.

- timestamp: 2026-08-29T11:36:30-03:00
  checked: Sessão atual do navegador integrado.
  found: Não há abas abertas nem uma aba do painel que possa ser reivindicada.
  implication: É necessário abrir diretamente o painel oficial e verificar se a autenticação persiste; nenhuma ação remota foi realizada.

- timestamp: 2026-08-29T12:16:30-03:00
  checked: Ativação na VPS autenticada e estado do gateway Hermes.
  found: O repositório remoto já estava em 364c8f0. O ativador instalou APV2_FINANCE_CALLBACK_BEGIN no adapter real em /usr/local/lib/hermes-agent/plugins/platforms/telegram/adapter.py, compilou o arquivo, atualizou o V2 e reiniciou o gateway de usuário com sucesso.
  implication: O processo que recebe os callbacks do Telegram passou a executar o handler versionado. O override HERMES_PYTHON apontou para /usr/local/lib/hermes-agent/venv/bin/python porque /usr/local/bin/hermes é um wrapper Bash.

- timestamp: 2026-08-29T12:20:00-03:00
  checked: Alerta de serviços Hermes duplicados.
  found: O gateway de usuário está ativo. A unidade antiga /etc/systemd/system/hermes-gateway.service está habilitada, mas falha com status 200/CHDIR e entra em auto-restart; portanto ela não estava processando os callbacks.
  implication: A unidade antiga deve ser removida em manutenção separada, mediante autorização, mas não bloqueia a correção funcional validada.

- timestamp: 2026-08-29T12:22:00-03:00
  checked: Teste humano de ponta a ponta no Telegram após a ativação.
  found: O usuário clicou nos botões individuais e confirmou que as transações foram efetivamente confirmadas.
  implication: A correção está validada no ambiente real, incluindo entrega do callback, roteamento pelo Hermes e confirmação financeira.

## Resolution

root_cause: O commit 083a981 agregou as 15 confirmações do modo Hermes em um único ReplyKeyboardMarkup one_time_keyboard. Reply keyboards são globais ao chat e não pertencem às mensagens; ao primeiro toque o Telegram envia o texto e oculta o teclado completo. A implementação evitou InlineKeyboard porque o Hermes detém o long polling e ignora callback_data arbitrário, mas essa limitação não foi resolvida, apenas contornada com UX incompatível com o requisito.
fix: InlineKeyboard individual por transação no V2 e handler estreito/aplicado idempotentemente no gateway Hermes para converter o callback autorizado em texto de confirmação ao agente, removendo apenas o markup da mensagem clicada. O script de ativação faz backup e py_compile; após o deploy do V2, uma falha de restart mantém o adapter persistido, retorna erro e exige restart real (sem recomendar /reload-mcp, que não recarrega Python).
verification: Testes focados do job e patcher 7/7; integração de ativação/restart 2/2; suíte completa 81 arquivos e 428 testes; typecheck e build aprovados; patch aplicado e compilado contra o adapter oficial Hermes 77001a6; segunda aplicação idempotente; bash -n, node --check e git diff --check aprovados; ativação na VPS concluída e confirmação humana de ponta a ponta aprovada no Telegram.
files_changed: [apps/server/src/jobs/finance-review.ts, apps/server/src/jobs/finance-review.test.ts, scripts/patch-hermes-finance-callback.mjs, apps/server/src/lib/hermes-finance-callback-patch.test.ts, apps/server/src/lib/hermes-activation.test.ts, scripts/activate-hermes-telegram.sh]
