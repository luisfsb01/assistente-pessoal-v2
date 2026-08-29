---
status: investigating
trigger: 'A funcionalidade de viagens no Hermes atualiza o roteiro de "Casamento Caio e Miriam", mas travel_import_gmail analisa 59 e-mails e retorna zero reservas para voos São José do Rio Preto → Fortaleza, volta por Natal, e hotéis em Fortaleza, Grossos e Natal.'
created: 2026-08-26T21:20:52.4455331-03:00
updated: 2026-08-29T17:15:00-03:00
---

## Current Focus

hypothesis: A extração de voos está resolvida, mas o early stop considera apenas quantidade de candidatos fortes e pode interromper antes da consulta de hotéis em roteiros com várias consultas de pares de aeroportos.
test: Exigir a execução de todas as consultas dirigidas de rota, hotel e voo e reservar 10 das 18 análises para candidatos com sinais de hospedagem.
expecting: A busca preserva os dois voos já encontrados e passa a avaliar os comprovantes de Fortaleza, Grossos e Natal dentro do mesmo limite de 18 chamadas.
next_action: Validar, implantar e repetir a busca para importar os hotéis.

## Symptoms

expected: travel_import_gmail deve pesquisar e-mails de forma abrangente e dirigida pelo roteiro já conhecido, incluindo cidades/origens/destinos, aeroportos e variações relevantes, remetentes/plataformas comuns, assuntos, corpo e anexos; extrair confirmações reais de voos e hotéis e salvar reservas com evidência suficiente, sem inventar dados.
actual: após o roteiro ser atualizado, a importação analisou apenas 59 e-mails e não encontrou nenhuma reserva com confiança suficiente, apesar de o usuário afirmar ter voos e hotéis em Fortaleza, Grossos e Natal; o agente então pediu pistas manuais que já deveriam ser inferidas do contexto.
errors: Não houve erro técnico explícito; houve resultado vazio/falso negativo e mensagem genérica.
reproduction: 'No Hermes, para a viagem Casamento Caio e Miriam, dizer: "A ida dessa viagem será saindo de São José do Rio Preto para Fortaleza, a volta por Natal. Procure nos meus e-mails as informações dos voos para deixar salvo. Tenho tbm hotel em Fortaleza, grossos e Natal. Salve as informações de hotel também". Observar travel_update_trip + travel_import_gmail, 59 e-mails analisados e zero reservas.'
started: Comportamento observado após a integração/migração da funcionalidade de viagens para o Hermes; não sabemos se já funcionou corretamente antes.

## Eliminated

- hypothesis: O limiar de confiança high deve ser relaxado para medium.
  evidence: O teste existente confirma que medium representa ambiguidade e deve continuar sem persistência; ampliar o contexto entregue ao extrator permite obter high sem reduzir a segurança.
  timestamp: 2026-08-26T21:31:00-03:00
- hypothesis: A deduplicação no banco descarta reservas distintas.
  evidence: saveTripReservation deduplica por trip+kind+confirmationCode quando há localizador e, sem ele, por trip+sourceEmailId+sourceItemKey; o falso negativo ocorre antes de saveReservation ser chamado.
  timestamp: 2026-08-26T21:31:00-03:00
- hypothesis: searchEmails não pagina.
  evidence: A implementação segue nextPageToken até o limite pedido; o defeito é o teto artificial de 50 na biblioteca e o chamador pedir apenas 30.
  timestamp: 2026-08-26T21:31:00-03:00

## Evidence

- timestamp: 2026-08-26T21:29:00-03:00
  checked: Construção e execução das buscas em travel-email-import.ts.
  found: A ferramenta executa duas consultas com maxResults=30, o que torna 59 e-mails um resultado esperado de 60 candidatos menos um duplicado; depois ordena o conjunto por data crescente e processa somente slice(0, 40).
  implication: O relato de 59 confirma que os limites internos foram atingidos; até 19 candidatos retornados nem sequer foram avaliados pelo extrator.
- timestamp: 2026-08-26T21:29:00-03:00
  checked: Contexto usado em buildTravelEmailQueries e extractionPrompt.
  found: A busca usa apenas destination e name, reduzidos às quatro primeiras palavras; notes não participa. O prompt do extrator também omite notes.
  implication: Um roteiro multi-cidade salvo em notes ou depois das primeiras palavras não dirige nem ajuda a validação dos candidatos.
- timestamp: 2026-08-26T21:29:00-03:00
  checked: Leitura de mensagens em gmail.ts.
  found: searchEmails pagina corretamente até o limite solicitado e lê text/plain ou text/html recursivamente, mas ignora partes com attachmentId e não extrai anexos.
  implication: Paginação da biblioteca funciona, mas o chamador impõe limite baixo; confirmações presentes apenas em anexo não podem ser extraídas.
- timestamp: 2026-08-26T21:31:00-03:00
  checked: Seis testes de regressão executados contra o código original.
  found: Falharam exatamente os cenários de notes/multi-cidade/aeroportos, compra com mais de 45 dias de antecedência, candidato relevante após o corte de 40, notes ausente no prompt, paginação acima de 50 e PDF anexo.
  implication: A causa raiz está reproduzida de forma determinística e cada mecanismo defeituoso tem proteção de regressão.
- timestamp: 2026-08-26T21:35:25.2827434-03:00
  checked: Testes focados após a correção.
  found: 25 testes passaram em gmail, importador de viagens, MCP e tools, incluindo multi-cidade/aeroportos/plataformas, janela temporal, ranking além do teto, paginação e PDF.
  implication: Todos os mecanismos reproduzidos estão corrigidos sem relaxar alta confiança.
- timestamp: 2026-08-26T21:39:58.1364165-03:00
  checked: Regressão global, tipos, build e higiene do diff.
  found: Na revisão final, anexos ficaram opt-in somente para a importação de viagens; 435 testes em 81 arquivos passaram novamente; npm run typecheck e npm run build terminaram com exit code 0; git diff --check não encontrou erros (somente aviso de conversão LF/CRLF).
  implication: A correção está estável localmente e pronta para implantação/verificação real.
- timestamp: 2026-08-26T21:42:07.9448277-03:00
  checked: Auditoria de complexidade solicitada na revisão final.
  found: buildTravelEmailQueries pode gerar cinco consultas; cada searchEmails carrega mensagens completas e anexos antes da deduplicação entre consultas; EXTRACTION_LIMIT=80 executa generate sequencialmente; attachmentText chama attachments.get antes de supportedDocumentName.
  implication: Mesmo com recall correto, latência de Gmail, PDF e modelo pode causar timeout e recriar um falso negativo operacional.
- timestamp: 2026-08-26T21:44:38.2245681-03:00
  checked: Quatro testes comportamentais executados contra a primeira correção.
  found: attachmentCalls trouxe inline-image+PDF; generate foi chamado 80 vezes; nenhuma query recebeu IDs já vistos; searchEmails foi chamado cinco vezes apesar de 12 candidatos fortes.
  implication: O risco de timeout é reproduzido diretamente por contagens, sem depender de ambiente externo.
- timestamp: 2026-08-29T11:05:00-03:00
  checked: Otimização de consultas, anexos e chamadas ao extrator.
  found: Cada consulta recebe os IDs já encontrados; o Gmail os exclui antes de carregar a mensagem. As duas buscas centrais (voo/hotel) sempre rodam, mas fallbacks param quando há ao menos 10 candidatos fortes. O ranking limita generate aos 30 melhores. MIME/extensão é filtrado antes do download.
  implication: A cobertura ampliada permanece, mas consultas sobrepostas não repetem corpo/anexos e a etapa mais cara tem teto previsível.
- timestamp: 2026-08-29T11:10:00-03:00
  checked: E-mail com sete imagens inline antes de um PDF de confirmação.
  found: Nenhuma imagem foi baixada; o PDF continuou elegível apesar de aparecer depois das seis primeiras partes MIME e seu texto foi extraído corretamente.
  implication: Logos/assinaturas não consomem o limite de documentos nem escondem o comprovante relevante.
- timestamp: 2026-08-29T11:11:00-03:00
  checked: Validação final após a otimização.
  found: Suíte completa passou 81 arquivos/438 testes; após o último endurecimento de anexos, os 21 testes focados passaram. Typecheck e build finais retornaram exit code 0; git diff --check não encontrou erros.
  implication: A correção de recall e as proteções contra timeout estão estáveis localmente; resta somente a prova com a caixa Gmail real após implantação.

- timestamp: 2026-08-29T14:42:00-03:00
  checked: Teste autorizado no Telegram após commit 6a0ba94 e /reload-mcp bem-sucedido.
  found: O Hermes reconectou assistente_v2 com 23 ferramentas e chamou travel_import_gmail, mas a chamada excedeu o timeout de 60 segundos. A releitura da viagem não encontrou reservas salvas.
  implication: O falso negativo original deixou de ser o único problema; a execução real confirma que o custo sequencial de Gmail/anexos e até 30 chamadas de julgamento não cabe no limite operacional do MCP.

- timestamp: 2026-08-29T14:46:00-03:00
  checked: Concorrência limitada e regressão focada.
  found: Mensagens completas e anexos agora são carregados com concorrência máxima 8; julgamentos usam concorrência máxima 6 e as gravações continuam sequenciais. Os testes de pico confirmam mais de uma operação simultânea sem ultrapassar os limites. Os 23 testes focados e o typecheck passaram.
  implication: O caminho crítico foi reduzido sem relaxar confidence=high nem introduzir gravações concorrentes; falta verificar o tempo na caixa real.

- timestamp: 2026-08-29T16:20:00-03:00
  checked: Teste real após deploy do commit f9ec12a.
  found: A ferramenta concluiu dentro do limite e retornou 160 e-mails encontrados, 30 analisados, zero confirmações seguras e zero reservas salvas.
  implication: A correção de desempenho foi validada. O conjunto amplo continua com baixa precisão e o problema agora está no ranking/consulta, não em timeout ou registro do MCP.

- timestamp: 2026-08-29T16:24:00-03:00
  checked: Auditoria dos termos de aeroporto e regressão de precisão.
  found: O termo FOR era normalizado para “for” e somava cinco pontos em qualquer e-mail inglês com essa palavra; também aparecia isolado nas consultas amplas. O ranking agora exige códigos de três letras em maiúsculas e as consultas com FOR exigem outro grupo de aeroporto, como SJP ou NAT. Doze testes focados e typecheck passaram.
  implication: E-mails genéricos em inglês deixam de ocupar o corte dos 30 candidatos, enquanto comprovantes com rotas reais preservam a pontuação alta.

- timestamp: 2026-08-29T16:28:00-03:00
  checked: Teste real após deploy do commit 474560c.
  found: A consulta precisa concluiu com 18 e-mails encontrados/analisados, mas ainda retornou zero confirmações de alta confiança e zero reservas.
  implication: O ruído de FOR foi eliminado e o conjunto candidato ficou pequeno; o bloqueio restante é a decisão do extrator, provavelmente circular porque as datas que validariam a relação ainda precisam ser extraídas desses e-mails.

- timestamp: 2026-08-29T16:31:00-03:00
  checked: Regra para viagens sem datas e diagnóstico de candidatos.
  found: O extrator agora aceita como alta confiança confirmação futura com fornecedor/localizador e rota/cidade compatível sem exigir nome/motivo no e-mail. Resultados vazios retornam até dez pistas com data, remetente, assunto e score. Dezoito testes focados e typecheck passaram.
  implication: A associação deixa de depender das datas ausentes da viagem sem relaxar a exigência de confirmação efetiva e compatibilidade explícita; qualquer novo vazio será diagnosticável.

- timestamp: 2026-08-29T16:37:00-03:00
  checked: Teste real após deploy do commit c6fba7a.
  found: A busca concluiu com 18 candidatos e zero reservas. As pistas identificaram dois e-mails de 2026 diretamente compatíveis: LATAM, assunto “Você já comprou sua viagem a Fortaleza”, de 13/05/2026, e Vai de Promo, passagem emitida, de 06/05/2026. Os demais candidatos eram viagens antigas ou destinos incompatíveis.
  implication: Busca e ranking estão entregando os comprovantes corretos ao extrator; o falso negativo restante está exclusivamente no julgamento do conteúdo. É necessário registrar a justificativa segura do extrator para corrigir a condição exata.

- timestamp: 2026-08-29T16:44:00-03:00
  checked: Teste real após deploy do diagnóstico do commit 6942e4c.
  found: Todos os 18 candidatos retornaram a justificativa de fallback “Falha ao analisar o candidato”, confiança baixa, matched=false e zero reservas. Isso só ocorre no catch em torno de generate; nenhuma decisão do modelo foi produzida.
  implication: O problema não é o limiar de confiança nem a associação da viagem. Todas as chamadas de Structured Outputs falham tecnicamente antes do julgamento.

- timestamp: 2026-08-29T16:48:00-03:00
  checked: JSON Schema gerado pelo AI SDK para o schema atual.
  found: details: z.record(z.unknown()) vira additionalProperties={}, formato não aceito pelo modo estrito de Structured Outputs da OpenAI. Nenhum outro schema de generateAgentObject no projeto usa mapa livre.
  implication: A falha uniforme das 18 chamadas tem uma causa determinística no contrato de resposta. details precisa ser um objeto fechado.

- timestamp: 2026-08-29T17:08:00-03:00
  checked: Teste real após deploy do schema fechado no commit cca036e e releitura pelo travel_get_summary.
  found: A importação salvou e verificou duas reservas: LATAM em 28/10/2026, São José do Rio Preto → Brasília → Fortaleza, e Azul em 05/11/2026, registrada como São José do Rio Preto → Natal. A releitura confirmou exatamente duas reservas no banco. Nenhum hotel foi analisado/salvo.
  implication: Structured Outputs e persistência estão corrigidos. O bloqueio restante dos hotéis está na seleção de consultas/candidatos, não mais na extração nem no banco.

## Resolution

root_cause: A importação tinha falhas sucessivas de recuperação e execução: buscava contexto truncado, ignorava notes/aeroportos/anexos, cortava candidatos e executava lentamente. Após corrigir recall, ranking e timeout, a causa final do resultado vazio era details: z.record(z.unknown()) no schema do extrator, convertido para additionalProperties={}, incompatível com Structured Outputs estrito; por isso todas as chamadas generate falhavam antes do julgamento.
fix: Queries usam destination+notes+name+purpose, cidades/aeroportos, tipos de reserva e plataformas comuns; janela foi ampliada para dois anos; Gmail pagina e extrai anexos suportados. Há deduplicação, ranking e concorrência limitada. Códigos de aeroporto exigem maiúsculas e FOR só aparece combinado com outra localidade. Viagens sem datas aceitam confirmação futura compatível. O schema do extrator usa details fechado, com segments estruturados e notes. Todas as consultas dirigidas de rota, hotel e voo são obrigatórias antes do early stop, e 10 das 18 vagas de extração ficam reservadas a hospedagens.
verification: O teste real após o schema fechado salvou e releu duas reservas de voo no banco, comprovando extração e persistência. Falta validar localmente a cota de hotéis e repetir a prova real para Fortaleza, Grossos e Natal.
files_changed:
  - apps/server/src/lib/gmail.ts
  - apps/server/src/lib/gmail.test.ts
  - apps/server/src/services/travel-email-import.ts
  - apps/server/src/services/travel-email-import.test.ts
  - apps/server/src/mcp/travel-tools.ts
  - apps/server/src/mcp/travel-tools.test.ts
  - apps/server/src/tools/trips.test.ts
  - docs/hermes/skills/assistente-pessoal-v2/SKILL.md
