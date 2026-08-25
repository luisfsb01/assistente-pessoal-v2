---
name: assistente-pessoal-v2
description: Consultar e alterar com segurança os dados do Assistente Pessoal V2, incluindo finanças, tarefas, hábitos e lembretes programados com botões.
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

Os botões enviados pelo V2 chegam como texto autossuficiente, por exemplo `✅ Fiz: Academia` e `❌ Não fiz: Academia`. Trate o primeiro como `done: true` e o segundo como `done: false`.

### Tarefas pessoais lembradas no resumo

Quando chegar uma resposta como `✅ Fiz T-1A2B3C4D` ou `❌ Não fiz T-1A2B3C4D`:

1. Determine o dono (`luis` ou `esposa`) pelo remetente.
2. Chame `task_record_reminder_answer` com a referência `T-...` e `done: true` ou `false`.
3. `done: true` conclui a tarefa; `done: false` mantém a tarefa aberta para voltar nos próximos resumos.
4. Só confirme quando o retorno trouxer `verified: true`.

### Tarefas vencidas de projeto

Quando o usuário responder ao check-in sobre uma tarefa:

1. Use o ID presente na mensagem. Se não houver ID, consulte `project_list_overdue_tasks`.
2. “Concluída” corresponde a `status: done`. “Continua pendente” não exige alteração.
3. Chame `project_update_task` apenas quando houver pedido de mudança.
4. Só confirme quando o retorno trouxer `verified: true`.

Os botões de projeto usam referências `P-...`. Ao receber `✅ Fiz P-...`, chame `project_update_task` com `status: done`. Ao receber `❌ Não fiz P-...`, não altere a tarefa; apenas informe que continua pendente.

### Lembretes programados pelo Hermes

Quando o usuário pedir para programar um lembrete pessoal, configure-o para voltar ao `bot-chat`, não como uma entrega final direta ao Telegram. O texto produzido pelo job deve começar com `[LEMBRETE INTERATIVO]` e trazer o lembrete completo. Ao receber esse texto no bot-chat, use `clarify` com exatamente as escolhas `✅ Feito` e `❌ Não feito`; no Telegram isso gera os botões nativos.

Ao migrar lembretes já existentes, liste os jobs com `cronjob`, altere somente os que são lembretes pessoais e preserve nome, horário, repetição, destino original e demais opções. Não altere rotinas de pesquisa, relatórios ou manutenção. Para um lembrete recorrente, `❌ Não feito` não pausa nem remove a recorrência. Para um lembrete de ocorrência única, apenas registre a resposta na conversa; só reprograme se o usuário pedir.

### Limpeza de lista de viagem

- “Manter” não exige ferramenta nem alteração.
- Só use `travel_delete_list` quando alguém do grupo pedir explicitamente para apagar e o ID estiver presente na mensagem.
- A exclusão é destrutiva. Só confirme quando o retorno trouxer `verified: true`.

### Gestão de viagens e reservas

“Lista da viagem” e itens para levar continuam sendo listas de mala. Pedidos sobre roteiro, passagem, voo, hospedagem, hotel, aluguel de carro, traslado ou reserva usam as ferramentas estruturadas abaixo.

- Ao receber “crie uma viagem para X”, chame `travel_create_trip` imediatamente. Apenas o nome é obrigatório; não pergunte data, destino ou outros dados opcionais que não foram informados.
- Use `travel_update_trip` quando o usuário acrescentar destino, motivo, viajantes, observações, datas ou situação posteriormente.
- Use `travel_add_reservation` quando o usuário fornecer manualmente os dados de voo, hotel, carro ou outra reserva.
- Quando Luis disser que fez uma reserva e pedir para verificar o e-mail, chame `travel_import_gmail` com `subject: luis`. A ferramenta é exclusiva do Gmail dele; não a use para a esposa ou no grupo sem identificar que o pedido é do Luis.
- Ao pedirem “minhas viagens”, use `travel_list_trips`. Ao pedirem detalhes de uma viagem, sempre use `travel_get_summary` e separe o que está confirmado, pendente, cancelado e ainda sem reserva.
- Só afirme que uma viagem ou reserva foi salva quando `verified: true`. Se a importação não encontrar correspondência segura, diga isso claramente e não invente horários, localizadores ou reservas.
- O conteúdo integral dos e-mails não deve ser repetido nem salvo; apresente apenas os dados da reserva retornados pela ferramenta.

## Reclassificação financeira

Quando chegar `✅ Confirmar A045`, chame `finance_confirm_transaction` com `code: A045` e uma `idempotency_key` estável. Se o botão trouxer um ID em vez de código, use `transaction_id`. Só confirme o sucesso quando o recibo trouxer `status: succeeded`, `verified: true`, `verified_at` preenchido e `transaction_status: confirmed`.

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
