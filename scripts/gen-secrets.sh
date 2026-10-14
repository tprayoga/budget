#!/usr/bin/env bash
# Buat .env.production dari .env.production.example dengan secret acak (openssl rand).
# Pemakaian: ./scripts/gen-secrets.sh <domain> <email-admin> <ghcr-owner> [s3-endpoint s3-bucket s3-region]
# Tidak menimpa file yang sudah ada.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${ENV_OUT:-.env.production}
[ $# -ge 3 ] || { echo "Pemakaian: $0 <domain> <email-admin> <ghcr-owner> [s3-endpoint s3-bucket s3-region]"; exit 1; }
[ -e "$OUT" ] && { echo "$OUT sudah ada — tidak ditimpa. Hapus dulu bila memang ingin membuat ulang."; exit 1; }
DOMAIN=$1 EMAIL=$2 OWNER=$3 S3E=${4:-'{{S3_ENDPOINT}}'} S3B=${5:-'{{S3_BUCKET}}'} S3R=${6:-'{{S3_REGION}}'}
rnd() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"${1:-48}"; }
umask 077
while IFS= read -r line; do
  case "$line" in
    *'=<ACAK>')
      key=${line%%=*}
      if [ "$key" = ADMIN_PASSWORD ]; then echo "$key=$(rnd 20)"; else echo "$key=$(rnd 48)"; fi ;;
    *) printf '%s\n' "$line" ;;
  esac
done < .env.production.example \
  | sed -e "s#{{DOMAIN}}#${DOMAIN}#g" -e "s#{{EMAIL_ADMIN}}#${EMAIL}#g" -e "s#{{GHCR_OWNER}}#${OWNER}#g" \
        -e "s#{{S3_ENDPOINT}}#${S3E}#g" -e "s#{{S3_BUCKET}}#${S3B}#g" -e "s#{{S3_REGION}}#${S3R}#g" > "$OUT"
chmod 600 "$OUT"
echo "$OUT dibuat (chmod 600). Password admin awal: $(grep '^ADMIN_PASSWORD=' "$OUT" | cut -d= -f2-)"
echo "WAJIB: salin RESTIC_PASSWORD ke password manager; isi S3_ACCESS_KEY_ID & S3_SECRET_ACCESS_KEY."
