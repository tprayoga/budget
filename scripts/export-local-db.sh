#!/usr/bin/env bash
# LANGKAH 1 MIGRASI (di mesin lokal): dump DB Docker lokal + uploads + manifest (jumlah baris & Rekap).
# DB Docker lokal TIDAK diubah. Hasil: migrasi/<tanggal>/{indotek-lokal.dump, uploads-lokal.tar.gz, manifest-lokal.txt}
# Pemakaian: ./scripts/export-local-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=migrasi/$(date +%Y%m%d-%H%M) && mkdir -p "$OUT" && chmod 700 migrasi "$OUT"
PGU=${POSTGRES_USER:-indotek} PGD=${POSTGRES_DB:-indotek_budget}
dcl() { docker compose -f docker-compose.yml "$@"; }
echo "== pg_dump $PGD (DB Docker lokal, read-only)"
dcl exec -T postgres pg_dump -U "$PGU" -d "$PGD" -Fc --no-owner > "$OUT/indotek-lokal.dump"
echo "== uploads"
tar -czf "$OUT/uploads-lokal.tar.gz" -C storage uploads
echo "== manifest"
{
  echo "# manifest DB lokal $(date -Iseconds)"
  echo "# jumlah baris per tabel"
  dcl exec -T postgres psql -U "$PGU" -d "$PGD" -Atc \
    "select table_name || ',' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from \"'||table_name||'\"', false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
  echo "# file upload: $(find storage/uploads -type f | wc -l | tr -d ' ')"
  echo "# rekap"
  (cd apps/api && npx ts-node --transpile-only scripts/rekap-snapshot.ts)
  echo "# sha256"
  (cd "$OUT" && shasum -a 256 indotek-lokal.dump uploads-lokal.tar.gz)
} > "$OUT/manifest-lokal.txt"
chmod 600 "$OUT"/*
echo "Selesai: $OUT"
grep REKAP_SHA256 "$OUT/manifest-lokal.txt"
echo "Lanjut: ./scripts/prepare-migration.sh $OUT   (dry-run cleanup di DB sementara)"
