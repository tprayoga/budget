#!/usr/bin/env bash
# Acceptance: backup → hapus DB → restore → Rekap sama persis (hash) + jumlah file upload sama.
# Pemakaian: scripts/acceptance/backup-restore.sh <env-file> <project>   (stack uji dengan profile backup-test / MinIO)
set -euo pipefail
ENV_FILE=$1 PROJECT=$2
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
PGU=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-); PGD=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)
snap() { dc exec -T api node dist-scripts/scripts/rekap-snapshot.js | grep REKAP_SHA256 | cut -d= -f2; }
files() { dc exec -T api sh -c 'find /app/storage/uploads -type f | wc -l' | tr -d ' \r'; }
dc --profile backup-test up -d minio >/dev/null 2>&1; sleep 3
H1=$(snap); F1=$(files); echo "Rekap sebelum : $H1 (file upload: $F1)"
echo "== backup"; ./scripts/backup-now.sh uji-restore --env-file "$ENV_FILE" --project "$PROJECT" | tail -3
echo "== HAPUS database & uploads"
dc stop api >/dev/null 2>&1
dc exec -T postgres psql -U "$PGU" -d postgres -c "drop database \"$PGD\" with (force)" -c "create database \"$PGD\""
dc run --rm --no-deps --entrypoint sh backup -c 'find /uploads -mindepth 1 -delete; echo "uploads dikosongkan"'
dc exec -T postgres psql -U "$PGU" -d "$PGD" -Atc "select count(*) from information_schema.tables where table_schema='public'" | sed 's/^/  tabel tersisa: /'
echo "== restore"; ./scripts/restore.sh latest --env-file "$ENV_FILE" --project "$PROJECT" </dev/null | tail -4
H2=$(snap); F2=$(files); echo "Rekap sesudah : $H2 (file upload: $F2)"
if [ "$H1" = "$H2" ] && [ "$F1" = "$F2" ]; then echo "LULUS: Rekap sama persis & file upload lengkap setelah restore"; else echo "GAGAL"; exit 1; fi
