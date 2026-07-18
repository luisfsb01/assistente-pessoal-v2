# Debug: calendar-explicit-only-and-stale-bot

## Status

RESOLVED

## Sintomas

- Esperado: tarefas normais ou recorrentes permanecem em Tarefas; calendário só é usado quando o usuário pede explicitamente calendário, agenda, evento ou compromisso.
- Atual: o Telegram ofereceu criar hábito ou evento recorrente e afirmou incorretamente que tarefas não têm recorrência automática.
- Reprodução: pedir `Retirar o lixo reciclável toda quarta-feira às 21h` como tarefa recorrente.

## Hipóteses

1. **Confirmada:** `buildTools` disponibiliza as ferramentas de calendário para qualquer mensagem que não esteja marcada como recorrente. A ausência de intenção explícita de calendário não é verificada.
2. **Confirmada:** o Telegram está executando a versão anterior da VPS. A resposta foi registrada às 19:05 UTC depois da correção local, a frase não existe no worktree atual e `HEAD` ainda coincide com `origin/master`; as 73 mudanças locais ainda não foram commitadas nem implantadas.

## Evidências

- Em `apps/server/src/agent/agent.ts`, a condição atual do calendário é apenas `canAccess && hasGoogleCreds && !taskRecurrence.explicit`.
- A frase `Tarefas não têm recorrência automática` não aparece no repositório atual.
- Há múltiplos processos Node ativos; a inspeção de linha de comando não retornou detalhes no ambiente restrito, então ainda não foi possível associá-los com segurança ao bot.

## Correção

- Detector determinístico de intenção explícita de calendário, incluindo continuidade imediata quando o bot pede um detalhe necessário.
- Ferramentas de calendário só são materializadas quando esse detector confirma `calendário`, `agenda`, `evento`, `compromisso` ou pedido equivalente.
- Mensagens negativas, como `não coloque no calendário`, mantêm essas ferramentas indisponíveis.
- Durante uma tarefa recorrente, ferramentas de hábito também ficam indisponíveis; o único fluxo possível é frequência, data final e criação da tarefa.
- O prompt recebe `hasCalendar=false` fora de um pedido explícito, evitando que a IA ofereça calendário espontaneamente.

## Verificação

- Tarefa recorrente com dia e horário: calendário indisponível.
- Tarefa normal sem intenção de agenda: calendário indisponível.
- `Adicione no calendário`: calendário disponível.
- `compromisso`, `evento` e `agenda`: calendário disponível.
- Resposta imediata a uma pergunta de horário do fluxo explícito: calendário continua disponível.
- `não coloque no calendário`: calendário indisponível.
- Testes direcionados: 47 aprovados.
- Typecheck do servidor: aprovado.

## Operação pendente

A correção está somente no worktree local. O bot da VPS continuará com o comportamento antigo até que as alterações sejam revisadas, commitadas, enviadas ao `master` e implantadas. Nenhum commit, push ou deploy foi feito nesta depuração.
