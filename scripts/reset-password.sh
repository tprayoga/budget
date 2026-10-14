#!/usr/bin/env bash
# Reset password satu akun (password sementara acak, wajib ganti saat login, semua sesi dicabut).
# Pemakaian: ./scripts/reset-password.sh <email> [--env-file .env.production] [--project indotek]
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="" ENV_FILE=.env.production PROJECT=indotek
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) EMAIL=$1 ;; esac; shift; done
[ -n "$EMAIL" ] || { echo "Pemakaian: $0 <email>"; exit 1; }
ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm --no-deps -T api \
  node dist-scripts/scripts/reset-password.js "$EMAIL"
