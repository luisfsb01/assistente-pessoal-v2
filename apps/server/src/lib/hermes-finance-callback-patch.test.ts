import { describe, expect, it } from 'vitest';
// O patcher é JavaScript puro porque roda na VPS antes do build TypeScript.
// @ts-expect-error arquivo operacional .mjs fora do rootDir do servidor
import { patchHermesFinanceCallback } from '../../../../scripts/patch-hermes-finance-callback.mjs';

const adapterFixture = `
class TelegramAdapter:
    async def _handle_callback_query(self, update, context):
        query = update.callback_query
        if not query or not query.data:
            return
        data = query.data
        query_message = getattr(query, "message", None)
        query_chat_id = getattr(query_message, "chat_id", None)
        query_chat = getattr(query_message, "chat", None)
        query_chat_type = getattr(query_chat, "type", None)
        query_thread_id = getattr(query_message, "message_thread_id", None)
        query_user_name = getattr(query.from_user, "first_name", None)

        # --- Model picker callbacks ---
        if data.startswith("mp:"):
            return
`;

describe('patchHermesFinanceCallback', () => {
  it('instala um callback financeiro que autentica, remove só o markup clicado e despacha texto ao agente', () => {
    const result = patchHermesFinanceCallback(adapterFixture);

    expect(result.changed).toBe(true);
    expect(result.source).toContain('if data.startswith("apv2:fin:")');
    expect(result.source).toContain('self._is_callback_user_authorized(');
    expect(result.source).toContain('await query.edit_message_reply_markup(reply_markup=None)');
    expect(result.source).toContain('text=f"✅ Confirmar {reference}"');
    expect(result.source).toContain('await self.handle_message(event)');
    expect(result.source.indexOf('apv2:fin:')).toBeLessThan(result.source.indexOf('# --- Model picker callbacks ---'));
  });

  it('é idempotente e não duplica o handler em uma nova ativação', () => {
    const first = patchHermesFinanceCallback(adapterFixture);
    const second = patchHermesFinanceCallback(first.source);

    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
    expect(second.source.match(/APV2_FINANCE_CALLBACK_BEGIN/g)).toHaveLength(1);
  });

  it('falha de forma segura quando a versão do Hermes não tem o ponto esperado', () => {
    expect(() => patchHermesFinanceCallback('class TelegramAdapter:\n    pass\n')).toThrow(
      /_handle_callback_query/,
    );
  });
});
