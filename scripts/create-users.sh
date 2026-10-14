#!/usr/bin/env bash
# Buat akun asli dari CSV (template: docs/users.template.csv). Password awal acak → file akun-baru-<tanggal>.csv (chmod 600).
# Pemakaian (di server, /opt/indotek): ./scripts/create-users.sh users.csv [--env-file .env.production] [--project indotek]
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
CSV="" ENV_FILE=.env.production PROJECT=indotek
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; *) CSV=$1 ;; esac; shift; done
[ -n "$CSV" ] && CSV=$(abs "$CSV"); ENV_FILE=$(abs "$ENV_FILE")
[ -f "$CSV" ] || { echo "Pemakaian: $0 <users.csv>"; exit 1; }
OUT=$CALLER_PWD/akun-baru-$(date +%Y%m%d-%H%M%S).csv
umask 077
ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm --no-deps -T \
  -v "$CSV:/data/users.csv:ro" api \
  node dist-scripts/scripts/create-users.js /data/users.csv --out - > "$OUT"
if [ -s "$OUT" ]; then
  echo "Password awal tersimpan di $OUT (chmod 600). Bagikan per orang lewat kanal aman (bukan grup), lalu: shred -u $OUT"
else
  rm -f "$OUT"
fi
