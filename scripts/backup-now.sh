#!/usr/bin/env bash
# Backup manual sekarang (selain jadwal harian 02:00 WIB). Pemakaian: ./scripts/backup-now.sh [tag] [--env-file f] [--project p]
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
ENV_FILE=.env.production PROJECT=indotek TAG=manual
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) TAG=$1 ;; esac; shift; done
ENV_FILE=$(abs "$ENV_FILE")
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
dc exec -T backup backup.sh "$TAG"
dc exec -T backup restic snapshots --host indotek --compact | tail -5
