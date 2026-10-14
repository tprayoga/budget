#!/usr/bin/env bash
# Backup sekali: pg_dump + uploads → snapshot restic, lalu retensi 14 harian + 8 mingguan.
# Argumen opsional: tag tambahan (mis. pre-deploy).
set -euo pipefail
TAG="${1:-harian}"
log() { echo "{\"level\":\"$1\",\"msg\":\"$2\",\"tag\":\"${TAG}\",\"time\":\"$(date -Iseconds)\"}"; }
trap 'log error "backup GAGAL"' ERR
export PGPASSWORD="${POSTGRES_PASSWORD}"
WORK=/tmp/backup && rm -rf "$WORK" && mkdir -p "$WORK/db"
restic cat config >/dev/null 2>&1 || { log info "inisialisasi repository restic"; restic init; }
pg_dump -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner -f "$WORK/db/indotek.dump"
psql -h "${POSTGRES_HOST:-postgres}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc \
  "select table_name || ',' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from \"'||table_name||'\"', false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" \
  > "$WORK/db/row-counts.csv"
restic backup --host indotek --tag "$TAG" "$WORK/db" /uploads
restic forget --host indotek --keep-daily 14 --keep-weekly 8 --prune
date +%s > /state/last_success
rm -rf "$WORK"
log info "backup selesai"
