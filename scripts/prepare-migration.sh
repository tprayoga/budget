#!/usr/bin/env bash
# LANGKAH 2 MIGRASI (di mesin lokal): restore dump ke DB SEMENTARA, lalu cleanup data uji coba.
#   default  : DRY-RUN — cleanup dijalankan dalam transaksi lalu di-rollback; tampilkan jumlah baris per tabel
#   --apply  : (setelah disetujui) terapkan cleanup di DB sementara, lalu buat FILE MIGRASI FINAL:
#              indotek-final.dump, uploads-final.tar.gz (tanpa file pengajuan uji coba), manifest-final.txt
# DB Docker lokal tidak pernah diubah. Pemakaian: ./scripts/prepare-migration.sh migrasi/<tanggal> [--apply]
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
DIR=$(abs "${1:?folder hasil export-local-db.sh}"); APPLY=${2:-}
PGU=${POSTGRES_USER:-indotek} TMP=indotek_migrasi_tmp
dcl() { docker compose -f docker-compose.yml "$@"; }
psqlt() { dcl exec -T postgres psql -U "$PGU" -v ON_ERROR_STOP=1 "$@"; }
echo "== DB sementara $TMP dari $DIR/indotek-lokal.dump"
psqlt -d postgres -c "drop database if exists $TMP with (force)" -c "create database $TMP" >/dev/null
dcl exec -T postgres pg_restore -U "$PGU" -d "$TMP" --no-owner --exit-on-error < "$DIR/indotek-lokal.dump"
URL="postgresql://${PGU}:${POSTGRES_PASSWORD:-indotek}@localhost:5432/${TMP}?schema=public"
REPORT="$DIR/cleanup-$([ "$APPLY" = "--apply" ] && echo apply || echo dryrun).json"
(cd apps/api && DATABASE_URL="$URL" npx ts-node --transpile-only scripts/migration-cleanup.ts ${APPLY:+--apply} --report "$REPORT")
if [ "$APPLY" != "--apply" ]; then
  echo
  echo "DRY-RUN selesai (tidak ada yang diubah). Setelah disetujui: ./scripts/prepare-migration.sh $DIR --apply"
  psqlt -d postgres -c "drop database $TMP with (force)" >/dev/null
  exit 0
fi
echo "== file migrasi final"
dcl exec -T postgres pg_dump -U "$PGU" -d "$TMP" -Fc --no-owner > "$DIR/indotek-final.dump"
# uploads tanpa file milik data uji coba (daftar dari laporan cleanup)
python3 - "$DIR" <<'PY'
import json, sys, tarfile, os
d = sys.argv[1]
drop = set(json.load(open(f"{d}/cleanup-apply.json"))["files"])
with tarfile.open(f"{d}/uploads-lokal.tar.gz") as src, tarfile.open(f"{d}/uploads-final.tar.gz", "w:gz") as dst:
    for m in src.getmembers():
        rel = m.name.split("uploads/", 1)[-1] if m.name.startswith("uploads/") else None
        if rel and rel in drop:
            continue
        dst.addfile(m, src.extractfile(m) if m.isfile() else None)
print(f"file upload dibuang: {len(drop)}")
PY
{
  echo "# manifest FINAL (setelah cleanup) $(date -Iseconds)"
  psqlt -d "$TMP" -Atc \
    "select table_name || ',' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from \"'||table_name||'\"', false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
  echo "# file upload: $(tar -tzf "$DIR/uploads-final.tar.gz" | grep -cv '/$')"
  (cd apps/api && DATABASE_URL="$URL" npx ts-node --transpile-only scripts/rekap-snapshot.ts | grep REKAP_SHA256)
  (cd "$DIR" && shasum -a 256 indotek-final.dump uploads-final.tar.gz)
} > "$DIR/manifest-final.txt"
chmod 600 "$DIR"/*
psqlt -d postgres -c "drop database $TMP with (force)" >/dev/null
echo "File migrasi final siap di $DIR: indotek-final.dump, uploads-final.tar.gz, manifest-final.txt"
echo "Salin ke server: scp $DIR/{indotek-final.dump,uploads-final.tar.gz,manifest-final.txt} deploy@<server>:/opt/indotek/migrasi/"
