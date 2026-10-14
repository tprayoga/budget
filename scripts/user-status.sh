#!/usr/bin/env bash
# Nonaktifkan / aktifkan akun (nonaktif: tidak bisa login, semua sesi dicabut).
# Pemakaian: ./scripts/user-status.sh <email> nonaktif|aktif [--env-file .env.production] [--project indotek]
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
EMAIL="" MODE="" ENV_FILE=.env.production PROJECT=indotek
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) if [ -z "$EMAIL" ]; then EMAIL=$1; else MODE=$1; fi ;; esac; shift; done
ENV_FILE=$(abs "$ENV_FILE")
[ -n "$EMAIL" ] && [ -n "$MODE" ] || { echo "Pemakaian: $0 <email> nonaktif|aktif"; exit 1; }
ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm --no-deps -T api \
  node dist-scripts/scripts/user-status.js "$EMAIL" "$MODE"
