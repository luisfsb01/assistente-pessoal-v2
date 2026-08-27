#!/usr/bin/env bash
# Migra a entrega das rotinas do bot antigo para o bot Telegram do Hermes.
# Não imprime o token e cria backups antes de alterar qualquer configuração.
set -euo pipefail

REPO="${APV2_REPO:-$HOME/assistente-pessoal-v2}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_ENV="${HERMES_ENV:-$HERMES_HOME/.env}"
HERMES_CONFIG="${HERMES_CONFIG:-$HERMES_HOME/config.yaml}"
APV2_ENV="$REPO/.env"
SKILL_SOURCE="$REPO/docs/hermes/skills/assistente-pessoal-v2/SKILL.md"
SKILL_TARGET="$HERMES_HOME/skills/assistente-pessoal-v2/SKILL.md"
PATCHER_SOURCE="$REPO/scripts/patch-hermes-finance-callback.mjs"
STAMP="$(date '+%Y%m%d-%H%M%S')"

for file in "$HERMES_ENV" "$HERMES_CONFIG" "$APV2_ENV" "$SKILL_SOURCE" "$PATCHER_SOURCE"; do
  if [ ! -f "$file" ]; then
    echo "Arquivo não encontrado: $file" >&2
    echo "Se o Hermes usa outro perfil, rode informando HERMES_HOME=/caminho/do/perfil." >&2
    exit 1
  fi
done

TOKEN="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$HERMES_ENV" | tail -n 1)"
TOKEN="${TOKEN%\"}"
TOKEN="${TOKEN#\"}"
TOKEN="${TOKEN%\'}"
TOKEN="${TOKEN#\'}"
case "$TOKEN" in
  *:*) ;;
  *) echo "TELEGRAM_BOT_TOKEN não foi encontrado ou parece inválido em $HERMES_ENV" >&2; exit 1 ;;
esac

HERMES_BIN="$(command -v hermes || true)"
if [ -z "$HERMES_BIN" ]; then
  echo "Executável hermes não encontrado no PATH." >&2
  exit 1
fi
HERMES_SHEBANG="${HERMES_PYTHON:-$(sed -n '1s/^#!//p' "$HERMES_BIN")}"
if [ -z "$HERMES_SHEBANG" ]; then
  echo "Não consegui identificar o Python usado por $HERMES_BIN." >&2
  echo "Informe explicitamente HERMES_PYTHON=/caminho/do/python-do-hermes." >&2
  exit 1
fi
read -r -a HERMES_PY_CMD <<< "$HERMES_SHEBANG"
HERMES_ADAPTER="$("${HERMES_PY_CMD[@]}" -c '
import importlib
import inspect

for module_name in ("plugins.platforms.telegram.adapter", "gateway.platforms.telegram"):
    try:
        module = importlib.import_module(module_name)
        adapter = getattr(module, "TelegramAdapter")
        path = inspect.getsourcefile(adapter)
        if path:
            print(path)
            break
    except (ImportError, AttributeError):
        continue
else:
    raise SystemExit("Adapter Telegram do Hermes não encontrado")
')"
if [ ! -f "$HERMES_ADAPTER" ]; then
  echo "Adapter Telegram do Hermes não encontrado: $HERMES_ADAPTER" >&2
  exit 1
fi

cp -- "$APV2_ENV" "$APV2_ENV.backup-$STAMP"
cp -- "$HERMES_CONFIG" "$HERMES_CONFIG.backup-$STAMP"
HERMES_ADAPTER_BACKUP="$HERMES_ADAPTER.backup-$STAMP"
cp -- "$HERMES_ADAPTER" "$HERMES_ADAPTER_BACKUP"
DEPLOY_COMMITTED=false
SKILL_EXISTED=false
if [ -f "$SKILL_TARGET" ]; then
  cp -- "$SKILL_TARGET" "$SKILL_TARGET.backup-$STAMP"
  SKILL_EXISTED=true
fi

rollback_on_error() {
  local exit_code=$?
  trap - EXIT
  if [ "$exit_code" -ne 0 ]; then
    if [ "$DEPLOY_COMMITTED" = true ]; then
      echo "A ativação ficou incompleta depois do deploy do V2." >&2
      echo "O adapter Hermes patchado foi mantido em disco para o próximo restart; as configurações não foram revertidas." >&2
    else
      cp -- "$APV2_ENV.backup-$STAMP" "$APV2_ENV"
      cp -- "$HERMES_CONFIG.backup-$STAMP" "$HERMES_CONFIG"
      cp -- "$HERMES_ADAPTER_BACKUP" "$HERMES_ADAPTER"
      if [ "$SKILL_EXISTED" = true ]; then
        cp -- "$SKILL_TARGET.backup-$STAMP" "$SKILL_TARGET"
      else
        rm -f -- "$SKILL_TARGET"
      fi
      echo "A ativação falhou antes do deploy e as configurações anteriores foram restauradas." >&2
    fi
  fi
  exit "$exit_code"
}
trap rollback_on_error EXIT

set_env_key() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$APV2_ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$APV2_ENV"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$APV2_ENV"
  fi
}

for tool in finance_confirm_transaction habit_list_pending habit_record_checkin task_list_due task_record_reminder_answer project_list_overdue_tasks project_update_task travel_delete_list travel_create_trip travel_list_trips travel_get_summary travel_update_trip travel_add_reservation travel_import_gmail knowledge_save_content knowledge_save_url knowledge_search; do
  if ! grep -q -- "- ${tool}$" "$HERMES_CONFIG"; then
    sed -i "/^[[:space:]]*- operations_list_receipts$/a\\        - ${tool}" "$HERMES_CONFIG"
  fi
done
for tool in finance_confirm_transaction habit_list_pending habit_record_checkin task_list_due task_record_reminder_answer project_list_overdue_tasks project_update_task travel_delete_list travel_create_trip travel_list_trips travel_get_summary travel_update_trip travel_add_reservation travel_import_gmail knowledge_save_content knowledge_save_url knowledge_search; do
  if ! grep -q -- "- ${tool}$" "$HERMES_CONFIG"; then
    echo "Não consegui adicionar ${tool} em $HERMES_CONFIG. Restaure o backup e confira o bloco tools.include." >&2
    exit 1
  fi
done

install -d -m 700 -- "$(dirname "$SKILL_TARGET")"
install -m 600 -- "$SKILL_SOURCE" "$SKILL_TARGET"

echo "Instalando o callback financeiro no gateway Hermes..."
node "$PATCHER_SOURCE" "$HERMES_ADAPTER"
"${HERMES_PY_CMD[@]}" -m py_compile "$HERMES_ADAPTER"

set_env_key HERMES_TELEGRAM_BOT_TOKEN "$TOKEN"
set_env_key TELEGRAM_LISTENER_ENABLED false
unset TOKEN
chmod 600 "$APV2_ENV" "$HERMES_ENV"

echo "Configuração preparada. Fazendo o deploy do V2..."
FORCE=1 bash "$REPO/scripts/deploy-pull.sh"
DEPLOY_COMMITTED=true

echo "Reiniciando o gateway Hermes..."
if ! hermes gateway restart; then
  echo "ERRO: o V2 foi atualizado e o patch foi salvo, mas o processo Hermes atual ainda não o carregou." >&2
  echo "Não use /reload-mcp: esse comando recarrega apenas servidores MCP, não o adapter Telegram." >&2
  echo "Em uma shell externa, tente novamente: hermes gateway restart" >&2
  echo "Se o gateway foi iniciado manualmente, encerre o processo atual e execute 'hermes gateway run' pelo mesmo supervisor ou sessão usados na instalação." >&2
  echo "Confirme com 'hermes gateway status' antes de executar a rotina financeira." >&2
  exit 1
fi

trap - EXIT

echo
echo "Migração concluída:"
echo "- listener do bot Assistente Pessoal: desativado"
echo "- rotinas do V2: entregues pelo bot Hermes"
echo "- confirmações financeiras e lembretes: botões ativados no Hermes"
echo "- revisão financeira: um botão inline independente por transação"
echo "- ferramentas de hábitos e tarefas: adicionadas ao Hermes"
echo "- segundo cérebro: salvamento e busca adicionados ao Hermes"
echo
echo "Teste no Telegram: envie /start ao HermesAgentAssistente e aguarde ou execute uma rotina manual de teste."
echo "Backups: $APV2_ENV.backup-$STAMP, $HERMES_CONFIG.backup-$STAMP e $HERMES_ADAPTER_BACKUP"
