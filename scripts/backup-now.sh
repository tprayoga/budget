#!/usr/bin/env bash
# Backup manual sekarang (selain jadwal harian 02:00 WIB). Pemakaian: ./scripts/backup-now.sh [tag] [--env-file f] [--project p]
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env.production PROJECT=indotek TAG=manual
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) TAG=$1 ;; esac; shift; done
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
dc exec -T backup backup.sh "$TAG"
dc exec -T backup restic snapshots --host indotek --compact | tail -5
