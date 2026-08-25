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
STAMP="$(date '+%Y%m%d-%H%M%S')"

for file in "$HERMES_ENV" "$HERMES_CONFIG" "$APV2_ENV"; do
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

cp -- "$APV2_ENV" "$APV2_ENV.backup-$STAMP"
cp -- "$HERMES_CONFIG" "$HERMES_CONFIG.backup-$STAMP"
SKILL_EXISTED=false
if [ -f "$SKILL_TARGET" ]; then
  cp -- "$SKILL_TARGET" "$SKILL_TARGET.backup-$STAMP"
  SKILL_EXISTED=true
fi

rollback_on_error() {
  local exit_code=$?
  trap - EXIT
  if [ "$exit_code" -ne 0 ]; then
    cp -- "$APV2_ENV.backup-$STAMP" "$APV2_ENV"
    cp -- "$HERMES_CONFIG.backup-$STAMP" "$HERMES_CONFIG"
    if [ "$SKILL_EXISTED" = true ]; then
      cp -- "$SKILL_TARGET.backup-$STAMP" "$SKILL_TARGET"
    else
      rm -f -- "$SKILL_TARGET"
    fi
    echo "A ativação falhou e as configurações anteriores foram restauradas." >&2
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

for tool in finance_confirm_transaction habit_list_pending habit_record_checkin task_list_due task_record_reminder_answer project_list_overdue_tasks project_update_task travel_delete_list knowledge_save_content knowledge_save_url knowledge_search; do
  if ! grep -q -- "- ${tool}$" "$HERMES_CONFIG"; then
    sed -i "/^[[:space:]]*- operations_list_receipts$/a\\        - ${tool}" "$HERMES_CONFIG"
  fi
done
for tool in finance_confirm_transaction habit_list_pending habit_record_checkin task_list_due task_record_reminder_answer project_list_overdue_tasks project_update_task travel_delete_list knowledge_save_content knowledge_save_url knowledge_search; do
  if ! grep -q -- "- ${tool}$" "$HERMES_CONFIG"; then
    echo "Não consegui adicionar ${tool} em $HERMES_CONFIG. Restaure o backup e confira o bloco tools.include." >&2
    exit 1
  fi
done

install -d -m 700 -- "$(dirname "$SKILL_TARGET")"
install -m 600 -- "$SKILL_SOURCE" "$SKILL_TARGET"

set_env_key HERMES_TELEGRAM_BOT_TOKEN "$TOKEN"
set_env_key TELEGRAM_LISTENER_ENABLED false
unset TOKEN
chmod 600 "$APV2_ENV" "$HERMES_ENV"

echo "Configuração preparada. Fazendo o deploy do V2..."
FORCE=1 bash "$REPO/scripts/deploy-pull.sh"

echo "Reiniciando o gateway Hermes..."
if ! hermes gateway restart; then
  echo "O restart automático não funcionou. Envie /reload-mcp ao bot Hermes." >&2
fi

trap - EXIT

echo
echo "Migração concluída:"
echo "- listener do bot Assistente Pessoal: desativado"
echo "- rotinas do V2: entregues pelo bot Hermes"
echo "- confirmações financeiras e lembretes: botões ativados no Hermes"
echo "- ferramentas de hábitos e tarefas: adicionadas ao Hermes"
echo "- segundo cérebro: salvamento e busca adicionados ao Hermes"
echo
echo "Teste no Telegram: envie /start ao HermesAgentAssistente e aguarde ou execute uma rotina manual de teste."
echo "Backups: $APV2_ENV.backup-$STAMP e $HERMES_CONFIG.backup-$STAMP"
