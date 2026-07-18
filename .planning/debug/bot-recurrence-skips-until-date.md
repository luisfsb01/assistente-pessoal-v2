# Debug: bot-recurrence-skips-until-date

## Status

RESOLVED

## Sintomas

- Esperado: ao mencionar explicitamente uma tarefa recorrente, o bot pergunta a frequência e, depois, a data final antes de criar.
- Atual: após receber a frequência, o bot pode criar a tarefa sem perguntar a data final.
- Erros: nenhum erro técnico visível; a falha é de controle do fluxo conversacional.

## Evidências

1. `buildSystemPrompt` contém a orientação correta: coletar frequência e data final e só então chamar `tasks_add`.
2. `tasks_add` declara `recurrence` como opcional no schema.
3. `buildTaskTools` recebe apenas a identidade do chat, sem o histórico ou um estado derivado da intenção de recorrência.
4. O teste existente `privado: owner default é o dono do chat` comprova que `{ title }` é suficiente para executar a criação imediatamente.
5. O histórico real mostrou uma segunda falha: `Retirar o lixo reciclável toda quarta-feira às 21 hrs` foi roteado para `calendar_create_event`; o Google recebeu um evento único e a resposta chamou esse evento de recorrente, apesar de a ferramenta não aceitar RRULE/recorrência.

## Causa raiz

A obrigatoriedade estava implementada apenas como instrução probabilística ao modelo. Não havia uma validação executável que soubesse que a conversa atual continha uma intenção explícita de recorrência. Assim, uma chamada de `tasks_add` sem `recurrence` era aceita e persistida como tarefa comum. Além disso, a presença de horário induziu o modelo a rotear um afazer recorrente para o calendário, cuja ferramenta só cria eventos únicos.

## Plano de correção

- [x] Derivar do histórico um estado conservador do fluxo de recorrência (intenção explícita, frequência informada e data final informada).
- [x] Fazer o agente perguntar deterministicamente o próximo campo ausente antes de chamar o modelo.
- [x] Passar esse estado às ferramentas de tarefas e bloquear `tasks_add` antes de qualquer persistência enquanto faltar informação.
- [x] Exigir `recurrence` na chamada quando a conversa explicitou recorrência.
- [x] Não expor as ferramentas de calendário durante um fluxo de tarefa recorrente.
- [x] Orientar que rotinas e afazeres domésticos recorrentes continuam sendo tarefas mesmo quando possuem horário.
- [x] Encerrar corretamente fluxos antigos após confirmação de tarefa ou evento criado e ignorar negações como `não é recorrente`.

## Verificação

- Caso real `toda quarta-feira`: frequência reconhecida, data final ausente, pergunta direta `Até qual data...`.
- Fluxo sem frequência: pergunta frequência primeiro.
- Depois da frequência: o modelo não é chamado; pergunta data final obrigatoriamente.
- Depois da data final: o modelo é liberado com contexto completo.
- `tasks_add`: nenhuma persistência se falta data final; nenhuma persistência se o modelo omite `recurrence`.
- Histórico legado encerrado por `Evento "..." criado` não contamina pedidos futuros.
- Mensagem `não é recorrente` não ativa o fluxo.
- Testes direcionados: 36 aprovados.
- Typecheck do servidor: aprovado.
