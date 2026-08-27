#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const APV2_FINANCE_CALLBACK_BEGIN = '# APV2_FINANCE_CALLBACK_BEGIN';
export const APV2_FINANCE_CALLBACK_END = '# APV2_FINANCE_CALLBACK_END';

const CALLBACK_BRANCH = `        # --- Assistente Pessoal V2: financial review callbacks ---
        ${APV2_FINANCE_CALLBACK_BEGIN}
        if data.startswith("apv2:fin:"):
            reference = data.split(":", 2)[2].strip().upper()
            if not re.fullmatch(r"(?:A\\d{3,}|[0-9A-F-]{36})", reference):
                await query.answer(text="Referência financeira inválida.")
                return

            caller_id = str(getattr(query.from_user, "id", ""))
            if not self._is_callback_user_authorized(
                caller_id,
                chat_id=query_chat_id,
                chat_type=str(query_chat_type) if query_chat_type is not None else None,
                thread_id=str(query_thread_id) if query_thread_id is not None else None,
                user_name=query_user_name,
            ):
                await query.answer(text="⛔ Você não está autorizado a confirmar esta transação.")
                return

            if query_message is None or query_chat_id is None:
                await query.answer(text="Não encontrei a mensagem desta transação.")
                return

            chat_type_value = getattr(query_chat_type, "value", query_chat_type)
            normalized_chat_type = str(chat_type_value or "").lower()
            if normalized_chat_type in {"group", "supergroup"}:
                gateway_chat_type = "group"
            elif normalized_chat_type == "channel":
                gateway_chat_type = "channel"
            else:
                gateway_chat_type = "dm"

            query_user = query.from_user
            source = self.build_source(
                chat_id=str(query_chat_id),
                chat_name=(
                    getattr(query_chat, "title", None)
                    or getattr(query_chat, "full_name", None)
                ),
                chat_type=gateway_chat_type,
                user_id=caller_id,
                user_name=(
                    getattr(query_user, "full_name", None)
                    or getattr(query_user, "first_name", None)
                ),
                thread_id=(
                    str(query_thread_id) if query_thread_id is not None else None
                ),
                message_id=str(getattr(query_message, "message_id", "")),
                is_bot=False,
            )
            event = MessageEvent(
                text=f"✅ Confirmar {reference}",
                message_type=MessageType.TEXT,
                source=source,
                raw_message=query_message,
                message_id=str(getattr(query_message, "message_id", "")),
                platform_update_id=getattr(update, "update_id", None),
                timestamp=getattr(query_message, "date", None),
            )

            await query.answer(text=f"Confirmando {reference}…")
            try:
                await query.edit_message_reply_markup(reply_markup=None)
            except Exception:
                pass
            await self.handle_message(event)
            return
        ${APV2_FINANCE_CALLBACK_END}

`;

export function patchHermesFinanceCallback(source) {
  const hasBegin = source.includes(APV2_FINANCE_CALLBACK_BEGIN);
  const hasEnd = source.includes(APV2_FINANCE_CALLBACK_END);
  if (hasBegin || hasEnd) {
    if (hasBegin && hasEnd) return { source, changed: false };
    throw new Error('O adapter Hermes contém um patch APV2 incompleto; restaure o backup antes de continuar.');
  }

  const callbackStart = source.indexOf('    async def _handle_callback_query(');
  if (callbackStart < 0) {
    throw new Error('Não encontrei _handle_callback_query no adapter Telegram do Hermes.');
  }

  const anchor = '        # --- Model picker callbacks ---';
  const anchorIndex = source.indexOf(anchor, callbackStart);
  if (anchorIndex < 0) {
    throw new Error('Não encontrei o ponto seguro de inserção antes dos callbacks do seletor de modelo.');
  }

  return {
    source: `${source.slice(0, anchorIndex)}${CALLBACK_BRANCH}${source.slice(anchorIndex)}`,
    changed: true,
  };
}

export async function patchHermesFinanceCallbackFile(adapterPath) {
  const source = await readFile(adapterPath, 'utf8');
  const result = patchHermesFinanceCallback(source);
  if (result.changed) await writeFile(adapterPath, result.source, 'utf8');
  return result.changed;
}

async function main() {
  const adapterPath = process.argv[2];
  if (!adapterPath) {
    throw new Error('Uso: node scripts/patch-hermes-finance-callback.mjs /caminho/adapter.py');
  }
  const changed = await patchHermesFinanceCallbackFile(adapterPath);
  console.log(changed ? 'Callback financeiro instalado no Hermes.' : 'Callback financeiro do Hermes já estava instalado.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
