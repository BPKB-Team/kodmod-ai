#!/usr/bin/env bash
# VPS release tooling. Run on the target host after configuring its private env.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
action="${1:-check}"
case "$action" in check|backup|deploy|smoke|compose) ;; *) echo 'Use check, backup, deploy, smoke or compose.' >&2; exit 2 ;; esac
test -f .env && test -f apps/ai-engine/.env || { echo 'Configure root and backend .env files first.' >&2; exit 1; }
read_env() {
  awk -v name="$1" 'index($0, name "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' .env
}
mode="${KODMOD_MODE:-$(read_env KODMOD_MODE)}"
mode="${mode:-https}"
[[ "$mode" == https || "$mode" == private ]] || { echo 'KODMOD_MODE must be https or private.' >&2; exit 2; }
if [[ "$action" == deploy ]]; then
  exec 9>/run/lock/kodmod-maintenance.lock
  flock -n 9 || { echo 'A KODMOD backup or deployment is already running.' >&2; exit 1; }
fi
compose=(docker compose --profile monitoring --profile monitoring-linux --env-file .env -f infra/docker/docker-compose.prod.yml)
validation_mode=prod
if [[ "$mode" == private ]]; then
  compose+=(-f infra/docker/docker-compose.private.yml)
  validation_mode=prod-private
fi
if [[ "$action" == compose ]]; then
  shift
  exec "${compose[@]}" "$@"
fi
"${compose[@]}" config --quiet
"${compose[@]}" config --format json | node scripts/check-compose.mjs "$validation_mode"

backup() {
  local directory="${KODMOD_BACKUP_DIR:-.runtime/backups}" name container
  mkdir -p -- "$directory"
  chmod 700 -- "$directory"
  name="kodmod-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}.dump"
  container="$("${compose[@]}" ps -q postgres)"
  test -n "$container" || { echo 'PostgreSQL must be running for backup.' >&2; return 1; }
  "${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"' sh "/tmp/$name"
  "${compose[@]}" exec -T postgres pg_restore --list "/tmp/$name" > "$directory/$name.list"
  docker cp "$container:/tmp/$name" "$directory/$name"
  test -s "$directory/$name"
  (cd -- "$directory" && sha256sum "$name" > "$name.sha256")
  "${compose[@]}" exec -T postgres rm -f "/tmp/$name"
  echo "Verified backup saved: $directory/$name"
}

case "$action" in
  check) echo "PASS VPS $mode mode, worker mounts and private service ports" ;;
  backup) backup ;;
  deploy)
    tag="${2:-}"
    [[ "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$ ]] || { echo 'Deploy requires a unique image tag.' >&2; exit 2; }
    export KODMOD_TAG="$tag"
    "${compose[@]}" build ai-engine web
    "${compose[@]}" up -d --wait --wait-timeout 120 postgres
    backup
    "${compose[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 240
    # Keep boot-time and subsequent Compose commands on the successful image tag.
    if grep -q '^KODMOD_TAG=' .env; then
      sed -i "s/^KODMOD_TAG=.*/KODMOD_TAG=$tag/" .env
    else
      printf '\nKODMOD_TAG=%s\n' "$tag" >> .env
    fi
    chmod 600 .env
    "${compose[@]}" ps --all
    echo 'Runtime updated. Run smoke and the authenticated acceptance checklist.' ;;
  smoke)
    if [[ "$mode" == private ]]; then
      web_port="$(read_env WEB_PORT)"
      api_port="$(read_env API_PORT)"
      DOCKER_WEB_ORIGIN="http://127.0.0.1:${web_port:-3100}" DOCKER_API_ORIGIN="http://127.0.0.1:${api_port:-8109}" node scripts/check-docker.mjs
      exit
    fi
    domain="$(sed -n 's/^APP_DOMAIN=//p' .env | head -n 1 | tr -d '\r')"
    [[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'APP_DOMAIN must be a domain without a scheme.' >&2; exit 2; }
    DOCKER_WEB_ORIGIN="https://$domain" DOCKER_API_ORIGIN="https://$domain" DOCKER_API_PREFIX='/api' node scripts/check-docker.mjs ;;
esac
