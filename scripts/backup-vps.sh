#!/usr/bin/env bash
# Consistent, private local snapshots. Copy verified snapshots off the VPS too.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
exec 9>/run/lock/kodmod-maintenance.lock
flock -n 9 || { echo 'A KODMOD backup or deployment is already running.' >&2; exit 1; }
compose() { bash scripts/release.sh compose "$@"; }
base="${KODMOD_BACKUP_DIR:-/srv/kodmod/backups}"
install -d -m 0700 "$base"
snapshot="$base/kodmod-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
install -d -m 0700 "$snapshot"
api="$(compose ps --all -q ai-engine)"
[[ -n "$api" ]] || { echo 'API container must exist before snapshot.' >&2; exit 1; }
image="$(docker inspect --format '{{.Image}}' "$api")"
audio="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/kodmod/audio"}}{{.Name}}{{end}}{{end}}' "$api")"
uploads="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/kodmod/uploads"}}{{.Name}}{{end}}{{end}}' "$api")"
[[ -n "$audio" && -n "$uploads" ]] || { echo 'Expected named media volumes.' >&2; exit 1; }
running=()
active="$(compose ps --status running --services)"
while IFS= read -r service; do
  case "$service" in web|ai-engine|worker) running+=("$service");; esac
done <<< "$active"
running_ids=()
for service in "${running[@]}"; do
  running_ids+=("$(compose ps -q "$service")")
done
resume() {
  result=$?
  trap - EXIT
  # Restart precisely the stopped containers, without rerunning migrations.
  if ((${#running_ids[@]})); then docker start "${running_ids[@]}" || result=1; fi
  exit "$result"
}
trap resume EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if ((${#running[@]})); then compose stop -t 30 "${running[@]}"; fi
KODMOD_BACKUP_DIR="$snapshot" bash scripts/release.sh backup
archive_volume() {
  docker run --rm --user 0:0 --network none --read-only --cap-drop ALL --cap-add DAC_OVERRIDE \
    --security-opt no-new-privileges:true --memory 128m --cpus 1 --pids-limit 64 \
    -v "$1:/source:ro" -v "$snapshot:/backup" --entrypoint sh "$image" \
    -c 'umask 077; tar -C /source -czf "/backup/$1.tar.gz" .' sh "$2"
  tar -tzf "$snapshot/$2.tar.gz" >/dev/null
}
archive_volume "$audio" audio
archive_volume "$uploads" uploads
private_files=(.env apps/ai-engine/.env)
if [[ -f .runtime/admin-password ]]; then private_files+=(.runtime/admin-password); fi
tar -czf "$snapshot/configuration.tar.gz" "${private_files[@]}"
chmod 0600 "$snapshot"/*
(cd -- "$snapshot" && sha256sum -- *.dump *.tar.gz > SHA256SUMS && sha256sum --check SHA256SUMS)
touch "$snapshot/COMPLETE"
echo "Verified full snapshot: $snapshot"
