#!/usr/bin/env bash
# LANGKAH 3 MIGRASI (di server): impor file migrasi final ke stack production yang BARU (belum berisi data).
#   1) verifikasi checksum  2) restore DB (DB dibuat ulang)  3) prisma migrate deploy  4) seed (admin awal dari env)
#   5) uploads  6) up -d + health  7) cek: jumlah baris vs manifest, Rekap sama, FundRequest = 0, akun aktif = 1,
#      akun demo tidak ada.
# Pemakaian: ./scripts/import-to-prod.sh <folder-migrasi> [--env-file .env.production] [--project indotek] [--force]
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }
DIR="" ENV_FILE=.env.production PROJECT=indotek FORCE=0
while [ $# -gt 0 ]; do case "$1" in --env-file) ENV_FILE=$2; shift ;; --project) PROJECT=$2; shift ;; --force) FORCE=1 ;; *) DIR=$1 ;; esac; shift; done
[ -n "$DIR" ] && DIR=$(abs "$DIR"); ENV_FILE=$(abs "$ENV_FILE")
[ -n "$DIR" ] && [ -f "$DIR/indotek-final.dump" ] && [ -f "$DIR/uploads-final.tar.gz" ] && [ -f "$DIR/manifest-final.txt" ] || { echo "Folder migrasi tidak lengkap"; exit 1; }
DIR=$(cd "$DIR" && pwd)
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
get() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2-; }
PGU=$(get POSTGRES_USER) PGD=$(get POSTGRES_DB) TAG=$(get TAG)
sql() { dc exec -T postgres psql -U "$PGU" -d "$PGD" -Atc "$1"; }
fail() { echo "GAGAL: $*"; exit 1; }

echo "== 1. checksum"
(cd "$DIR" && grep -E '(indotek-final.dump|uploads-final.tar.gz)$' manifest-final.txt | sha256sum -c -) || fail "checksum tidak cocok"

echo "== 2. restore database"
dc up -d postgres redis >/dev/null
for i in $(seq 1 30); do dc exec -T postgres pg_isready -U "$PGU" >/dev/null 2>&1 && break; sleep 2; done
EXISTING=$(dc exec -T postgres psql -U "$PGU" -d "$PGD" -Atc "select count(*) from information_schema.tables where table_name='Cluster'" 2>/dev/null || echo 0)
if [ "${EXISTING:-0}" != 0 ] && [ "$(sql 'select count(*) from "Cluster"')" != 0 ] && [ "$FORCE" != 1 ]; then
  fail "database production sudah berisi data cluster — import dibatalkan (pakai --force hanya bila yakin)"
fi
dc stop api caddy >/dev/null 2>&1 || true
dc exec -T postgres psql -U "$PGU" -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$PGD\" with (force)" -c "create database \"$PGD\"" >/dev/null
dc exec -T postgres pg_restore -U "$PGU" -d "$PGD" --no-owner --exit-on-error < "$DIR/indotek-final.dump"

echo "== 3. migrate deploy & 4. seed (master data insert-only + admin awal)"
dc run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy
dc run --rm --no-deps api node dist-scripts/prisma/seed.js

echo "== 5. uploads"
dc run --rm --no-deps --entrypoint sh -v "$DIR:/migrasi:ro" backup -c \
  'find /uploads -mindepth 1 -delete; mkdir -p /tmp/u && tar -xzf /migrasi/uploads-final.tar.gz -C /tmp/u && cp -a /tmp/u/uploads/. /uploads/ && chown -R 1000:1000 /uploads && find /uploads -type f | wc -l'

echo "== 6. up -d"
dc up -d >/dev/null
for i in $(seq 1 40); do [ "$(dc ps api --format '{{.Health}}' | grep -c healthy)" -ge 1 ] && break; sleep 3; done

echo "== 7. verifikasi"
ok=1
while IFS=, read -r t n; do
  case "$t" in \#*|"") continue ;; esac
  now=$(sql "select count(*) from \"$t\"")
  exp=$n; [ "$t" = User ] && exp=$((n + 1))   # + admin awal dari env
  [ "$t" = _prisma_migrations ] && continue
  if [ "$now" != "$exp" ]; then echo "  BEDA $t: manifest $n, sekarang $now"; ok=0; fi
done < <(sed -n '2,/^# file upload/p' "$DIR/manifest-final.txt" | grep -v '^#')
[ "$ok" = 1 ] && echo "  jumlah baris semua tabel sama dengan manifest (User +1 = admin awal)"
H_EXP=$(grep REKAP_SHA256 "$DIR/manifest-final.txt" | cut -d= -f2)
H_NOW=$(dc exec -T api node dist-scripts/scripts/rekap-snapshot.js | grep REKAP_SHA256 | cut -d= -f2)
[ "$H_EXP" = "$H_NOW" ] && echo "  Rekap sama persis ($H_NOW)" || { echo "  REKAP BEDA: manifest $H_EXP, sekarang $H_NOW"; ok=0; }
FR=$(sql 'select count(*) from "FundRequest"'); ACTIVE=$(sql 'select count(*) from "User" where active')
DEMO=$(sql "select count(*) from \"User\" where email like '%@indotek.test'")
echo "  FundRequest = $FR, akun aktif = $ACTIVE ($(sql 'select email from "User" where active')), akun demo = $DEMO"
[ "$FR" = 0 ] && [ "$ACTIVE" = 1 ] && [ "$DEMO" = 0 ] || ok=0
[ "$ok" = 1 ] && echo "IMPORT LULUS" || fail "verifikasi gagal — lihat di atas (data sudah di-restore; perbaiki lalu ulangi dengan --force)"
