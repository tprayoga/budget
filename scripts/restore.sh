#!/usr/bin/env bash
# Restore database + uploads dari snapshot restic (default: latest). API dihentikan selama restore.
# Pemakaian: ./scripts/restore.sh [snapshot-id|latest] [--env-file f] [--project p]
#   Daftar snapshot: docker compose -p indotek -f docker-compose.prod.yml --env-file .env.production exec backup restic snapshots
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
ENV_FILE=.env.production PROJECT=indotek SNAP=latest
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) SNAP=$1 ;; esac; shift; done
ENV_FILE=$(abs "$ENV_FILE")
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
echo "Restore snapshot '$SNAP' akan MENIMPA database & uploads production."
if [ -t 0 ]; then read -r -p "Ketik RESTORE untuk lanjut: " ok; [ "$ok" = RESTORE ] || exit 1; fi
REPLICAS=$(dc ps -q api | wc -l | tr -d ' '); REPLICAS=${REPLICAS:-1}; [ "$REPLICAS" -ge 1 ] || REPLICAS=1
dc stop api caddy
dc exec -T backup restore.sh "$SNAP" --yes
dc up -d --scale api="$REPLICAS" api caddy
for i in $(seq 1 40); do [ "$(dc ps api --format '{{.Health}}' | grep -c healthy)" -ge 1 ] && break; sleep 3; done
dc ps api caddy --format '{{.Name}} {{.Health}}'
echo "Restore selesai. Cek: rekap-snapshot & login (lihat RUNBOOK §Backup)."
