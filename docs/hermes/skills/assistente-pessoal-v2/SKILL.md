---
name: assistente-pessoal-v2
description: Consultar e alterar com segurança os dados do Assistente Pessoal V2, começando pelas finanças.
---

# Assistente Pessoal V2

Use as ferramentas `mcp_assistente_v2_*` para consultar e alterar os dados do usuário. Nunca acesse o Supabase diretamente e nunca afirme que uma alteração financeira foi concluída apenas porque a intenção foi entendida.

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
