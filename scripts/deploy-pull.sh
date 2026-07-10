#!/usr/bin/env bash
# Deploy "pull" da v2: a VPS verifica o master e redeploya se mudou.
# Roda via cron (a cada 30 min). Mesmo mecanismo da v1.
#
# Uso:
#   bash scripts/deploy-pull.sh          # deploya so se o master mudou
#   FORCE=1 bash scripts/deploy-pull.sh  # forca o deploy (1a vez / manual)
set -euo pipefail

# cron tem PATH minimo; garante docker/git/sed disponiveis.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

# Re-exec a partir de uma copia estavel: o 'git reset --hard' abaixo pode
# reescrever este proprio script durante a execucao.
if [ "${APV2_DEPLOY_STABLE:-}" != "1" ]; then
  cp -- "$0" /tmp/apv2-deploy-running.sh
  exec env APV2_DEPLOY_STABLE=1 FORCE="${FORCE:-}" /bin/bash /tmp/apv2-deploy-running.sh "$@"
fi

REPO="${APV2_REPO:-$HOME/assistente-pessoal-v2}"
LOG="${APV2_LOG:-$HOME/apv2-deploy.log}"

# Lock: nao sobrepoe execucoes (um build pesado pode passar de 30 min).
exec 9>/tmp/apv2-deploy.lock
flock -n 9 || exit 0

cd "$REPO"
git fetch origin master --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/master)"

if [ "${FORCE:-}" != "1" ] && [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # nada novo
fi

{
  echo "[$(date '+%F %T')] deploy ${LOCAL:0:7} -> ${REMOTE:0:7}"
  git reset --hard origin/master
  docker compose build
  docker compose --env-file .env -f docker-stack.yml config | sed '/^name:/d' > /tmp/apv2-stack.yml
  docker stack deploy -c /tmp/apv2-stack.yml assistente-v2
  # O Swarm NAO recria a task quando a imagem :latest e' rebuildada (mesma tag =
  # "sem mudanca" no spec). --force recria a task para subir a imagem nova.
  docker service update --force assistente-v2_assistente-v2
  rm -f /tmp/apv2-stack.yml
  echo "[$(date '+%F %T')] deploy OK"
} >> "$LOG" 2>&1
