#!/usr/bin/env bash
# Deploy satu rilis: pull image <tag> → snapshot backup → prisma migrate deploy → seed (master data & admin awal)
# → up -d → cek health lewat Caddy (HTTPS). Health gagal → kembali ke tag sebelumnya.
#
# Pemakaian (di server, folder /opt/indotek):
#   ./scripts/deploy.sh <git-sha>              # rilis baru
#   ./scripts/deploy.sh --rollback             # kembali ke tag sebelumnya
# Opsi: --no-pull (image sudah ada lokal), --no-backup, --env-file <file> (default .env.production)
set -euo pipefail
CALLER_PWD=$PWD
cd "$(dirname "$0")/.."
abs() { case "$1" in /*) echo "$1" ;; *) if [ -e "$CALLER_PWD/$1" ]; then echo "$CALLER_PWD/$1"; else echo "$PWD/$1"; fi ;; esac; }

ENV_FILE=.env.production PULL=1 BACKUP=1 TAG="" ROLLBACK=0 PROJECT=indotek
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0 ;;
    --no-backup) BACKUP=0 ;;
    --env-file) ENV_FILE=$2; shift ;;
    --project) PROJECT=$2; shift ;;
    --rollback) ROLLBACK=1 ;;
    -*) echo "opsi tidak dikenal: $1"; exit 1 ;;
    *) TAG=$1 ;;
  esac
  shift
done
ENV_FILE=$(abs "$ENV_FILE")
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE tidak ada (lihat RUNBOOK: gen-secrets.sh)"; exit 1; }
STATE=.deploy/$PROJECT && mkdir -p "$STATE"
CURRENT=$(cat "$STATE/current_tag" 2>/dev/null || true)
PREVIOUS=$(cat "$STATE/previous_tag" 2>/dev/null || true)
if [ "$ROLLBACK" = 1 ]; then
  [ -n "$PREVIOUS" ] || { echo "Tidak ada tag sebelumnya untuk rollback"; exit 1; }
  TAG=$PREVIOUS; BACKUP=0
  echo "Rollback image ke $TAG (migrasi database TIDAK dibatalkan — lihat RUNBOOK §Rollback)"
fi
[ -n "$TAG" ] || { echo "Pemakaian: $0 <git-sha> | --rollback"; exit 1; }

DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)
HTTPS_PORT=$(grep -E '^HTTPS_PORT=' "$ENV_FILE" | cut -d= -f2- || true)
HEALTH_URL="https://${DOMAIN}${HTTPS_PORT:+:$HTTPS_PORT}/api/health"
[ "${HTTPS_PORT:-443}" = 443 ] && HEALTH_URL="https://${DOMAIN}/api/health"
ACME_CA=$(grep -E '^ACME_CA=' "$ENV_FILE" | cut -d= -f2- || true)
case "$ACME_CA" in *staging*) CURL_INSECURE=1; echo "CATATAN: ACME_CA = Let's Encrypt STAGING — health check melewati verifikasi sertifikat (ganti ke production: RUNBOOK §3.4)" ;; esac
dc() { ENV_FILE="$ENV_FILE" TAG="$1" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "${@:2}"; }
log() { echo "[$(date '+%F %T')] $*"; }

if [ "$PULL" = 1 ]; then log "pull image $TAG"; dc "$TAG" pull api web backup; fi

if [ "$BACKUP" = 1 ] && [ -n "$CURRENT" ] && dc "$CURRENT" ps --status running backup | grep -q backup; then
  log "snapshot backup sebelum deploy (tag pre-deploy)"
  dc "$CURRENT" exec -T backup backup.sh pre-deploy || { log "backup pre-deploy GAGAL — deploy dibatalkan"; exit 1; }
fi

log "database & redis"
dc "$TAG" up -d postgres redis
log "prisma migrate deploy"
dc "$TAG" run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy
log "seed master data & admin awal (idempotent)"
dc "$TAG" run --rm --no-deps api node dist-scripts/prisma/seed.js

log "up -d (tag $TAG)"
dc "$TAG" up -d --remove-orphans

check() {
  for i in $(seq 1 30); do
    if curl -fsS ${CURL_INSECURE:+-k} --max-time 5 "$HEALTH_URL" >/tmp/indotek-health.json 2>/dev/null; then
      if grep -q "\"version\":\"$1\"" /tmp/indotek-health.json; then return 0; fi
    fi
    sleep 3
  done
  return 1
}
log "cek health $HEALTH_URL (versi $TAG)"
if check "$TAG"; then
  if [ "$TAG" != "$CURRENT" ]; then
    [ -n "$CURRENT" ] && echo "$CURRENT" > "$STATE/previous_tag"
    echo "$TAG" > "$STATE/current_tag"
  fi
  log "OK: $(cat /tmp/indotek-health.json)"
  exit 0
fi

log "HEALTH GAGAL untuk $TAG"
dc "$TAG" logs --tail 80 api || true
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ]; then
  log "rollback otomatis ke $CURRENT"
  dc "$CURRENT" up -d --remove-orphans
  check "$CURRENT" && log "rollback OK ($CURRENT aktif). Periksa log rilis $TAG." || log "ROLLBACK JUGA GAGAL — ikuti RUNBOOK §Insiden"
fi
exit 1
