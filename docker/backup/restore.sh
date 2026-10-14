#!/usr/bin/env bash
# Restore DB + uploads dari snapshot restic. Pemakaian: restore.sh [snapshot-id|latest] [--yes]
# PERINGATAN: menimpa database & folder uploads. API harus dihentikan dulu (restore.sh di host melakukannya).
set -euo pipefail
SNAP="${1:-latest}"
[ "${2:-}" = "--yes" ] || { echo "Tambahkan --yes untuk konfirmasi (DB & uploads akan ditimpa)"; exit 1; }
export PGPASSWORD="${POSTGRES_PASSWORD}"
rm -rf /restore/* && restic restore "$SNAP" --host indotek --target /restore
DUMP=$(find /restore -name indotek.dump | head -1)
[ -n "$DUMP" ] || { echo "indotek.dump tidak ada di snapshot"; exit 1; }
psql -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists \"${POSTGRES_DB}\" with (force)" -c "create database \"${POSTGRES_DB}\""
pg_restore -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --exit-on-error "$DUMP"
UP=$(find /restore -type d -path '*/uploads' | head -1)
if [ -n "$UP" ]; then
  find /uploads -mindepth 1 -delete
  cp -a "$UP"/. /uploads/
fi
echo "{\"level\":\"info\",\"msg\":\"restore selesai\",\"snapshot\":\"${SNAP}\"}"
