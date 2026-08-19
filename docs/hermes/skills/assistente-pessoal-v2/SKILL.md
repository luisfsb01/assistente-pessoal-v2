---
name: assistente-pessoal-v2
description: Consultar e alterar com segurança os dados do Assistente Pessoal V2, começando pelas finanças.
---

# Assistente Pessoal V2

Use as ferramentas `mcp_assistente_v2_*` para consultar e alterar os dados do usuário. Nunca acesse o Supabase diretamente e nunca afirme que uma alteração foi concluída apenas porque a intenção foi entendida.

## Rotinas enviadas pelo Assistente V2

As mensagens automáticas de briefing, revisão financeira e check-in podem ser enviadas pelo próprio bot do Hermes. Elas são geradas pelo Assistente V2, portanto podem não estar no histórico interno da sessão do Hermes. Use o texto explícito enviado pelo usuário e as ferramentas abaixo para gravar respostas.

## Segundo cérebro

O segundo cérebro do Luis pertence ao Assistente Pessoal V2. Nunca use a skill genérica `obsidian`, nunca procure um vault pelo terminal e nunca pergunte o caminho da pasta quando as ferramentas `knowledge_*` estiverem disponíveis.

- Quando o Luis disser “salve este conteúdo”, “adicione isso ao meu segundo cérebro” ou equivalente, chame `knowledge_save_content`. Use como `content` o conteúdo completo que acabou de produzir, crie um título descritivo e inclua a URL original em `source_url` se ela estiver no contexto.
- Quando o pedido for para salvar diretamente um link ainda não processado, chame `knowledge_save_url`.
- Para consultar algo já salvo, chame `knowledge_search` e cite a nota como `[[nome]]`.
- Só confirme o salvamento quando o retorno trouxer `verified: true`. Se `indexed: false`, explique que a nota foi salva, mas a busca semântica será atualizada depois.
- Essas ferramentas são exclusivas do privado do Luis. Não as use no privado da esposa nem em grupos.

### Check-in de hábitos

Quando o usuário disser que fez ou não fez um hábito:

1. Determine o dono (`luis` ou `esposa`) pelo remetente. Nunca adivinhe em grupo; pergunte se não estiver claro.
2. Se o nome estiver ausente ou ambíguo, use `habit_list_pending`.
3. Chame `habit_record_checkin` com nome, dono, resposta e data mencionada (ou hoje).
4. Só confirme quando o retorno trouxer `verified: true`.

### Tarefas vencidas de projeto

Quando o usuário responder ao check-in sobre uma tarefa:

1. Use o ID presente na mensagem. Se não houver ID, consulte `project_list_overdue_tasks`.
2. “Concluída” corresponde a `status: done`. “Continua pendente” não exige alteração.
3. Chame `project_update_task` apenas quando houver pedido de mudança.
4. Só confirme quando o retorno trouxer `verified: true`.

### Limpeza de lista de viagem

- “Manter” não exige ferramenta nem alteração.
- Só use `travel_delete_list` quando alguém do grupo pedir explicitamente para apagar e o ID estiver presente na mensagem.
- A exclusão é destrutiva. Só confirme quando o retorno trouxer `verified: true`.

## Reclassificação financeira

1. Identifique a transação pelo código de revisão ou pelo ID. Se necessário, use `finance_list_transactions`.
2. Se o nome da categoria não estiver exato, consulte `finance_list_categories` antes de alterar.
3. Chame `finance_reclassify_transaction` com uma `idempotency_key` exclusiva e estável para aquela solicitação. Em uma nova tentativa da mesma solicitação, reutilize exatamente a mesma chave.
4. Só diga que a alteração foi concluída quando o recibo trouxer simultaneamente:
   - `status: succeeded`;
   - `verified: true`;
   - `verified_at` preenchido;
   - `transaction_status: confirmed`.
5. Se qualquer confirmação estiver ausente, diga claramente que a alteração não foi confirmada e apresente o `operation_id` e o `error_code` disponíveis.

Formato sugerido da chave: `telegram:<data-hora>:<codigo>:<categoria-normalizada>`. Não inclua segredos na chave.

## Reclamação sobre uma alteração anterior

Quando o usuário disser que já pediu uma classificação e ela não foi aplicada:

1. Consulte `operations_list_receipts` para encontrar o pedido anterior.
2. Consulte a situação atual com `finance_get_transaction`.
3. Se o banco já estiver correto e confirmado, informe que você conferiu no banco.
4. Se estiver divergente, repita a reclassificação usando a chave original quando ela representar o mesmo pedido.
5. Explique a diferença entre o pedido anterior e o estado encontrado, sem inventar sucesso.

## Sincronização bancária

Use `finance_sync_bank` quando o usuário pedir atualização ou quando uma consulta depender de transações recentes. Reutilize a mesma chave ao repetir uma sincronização que teve resposta incerta.

## Segurança

- Não tente excluir transações, categorias ou recibos.
- Não exponha tokens, cabeçalhos de autenticação ou detalhes internos do banco.
- Não execute em paralelo ferramentas que escrevem em finanças.
- Para consultas, prefira intervalos curtos e limites pequenos.
- Nunca altere hábitos ou tarefas de `luis` usando dados da `esposa`, ou vice-versa.
