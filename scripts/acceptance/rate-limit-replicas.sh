#!/usr/bin/env bash
# Acceptance: rate limit login tetap berlaku dengan 2 replika API (bukti Redis dipakai).
# Pemakaian: scripts/acceptance/rate-limit-replicas.sh <env-file> <project> <base-url>
set -euo pipefail
ENV_FILE=$1 PROJECT=$2 BASE=$3
dc() { ENV_FILE="$ENV_FILE" docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
LIMIT=$(grep -E '^LOGIN_RATE_LIMIT=' "$ENV_FILE" | cut -d= -f2-); LIMIT=${LIMIT:-5}
echo "== scale api=2"
dc up -d --no-recreate --scale api=2 api >/dev/null 2>&1
for i in $(seq 1 40); do [ "$(dc ps api --format '{{.Health}}' | grep -c healthy)" = 2 ] && break; sleep 2; done
dc ps api --format '{{.Name}} {{.Health}}'
EMAIL="uji-rate-$(date +%s)@contoh.invalid"
echo "== $((LIMIT + 2)) login salah untuk $EMAIL lewat Caddy (round-robin)"
seen=""
codes=()
for i in $(seq 1 $((LIMIT + 2))); do
  out=$(curl -sk -o /dev/null -D - -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
        --data "{\"email\":\"$EMAIL\",\"password\":\"salah-salah\"}")
  code=$(echo "$out" | head -1 | awk '{print $2}')
  inst=$(echo "$out" | grep -i '^x-instance:' | awk '{print $2}' | tr -d '\r')
  case " $seen " in *" $inst "*) ;; *) seen="$seen $inst" ;; esac; codes+=("$code")
  echo "  percobaan $i → HTTP $code (replika $inst)"
done
echo "== key di Redis"
REDIS_PASSWORD=$(grep -E '^REDIS_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
dc exec -T redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "rl:login:*$EMAIL" | sed 's/^/  /'
dc exec -T redis sh -c "redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning zcard \"\$(redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning --scan --pattern 'rl:login:*$EMAIL' | head -1)\"" | sed 's/^/  jumlah percobaan tercatat: /'
expected=$(printf '401 %.0s' $(seq 1 "$LIMIT"))"429 429 "
actual="${codes[*]} "
n=$(echo $seen | wc -w | tr -d " ")
echo "== replika berbeda yang melayani: $n ($seen )"
if [ "$actual" = "$expected" ] && [ "$n" -ge 2 ]; then
  echo "LULUS: $LIMIT ditolak password salah (401), sesudahnya 429 — hitungan dibagi lintas $n replika lewat Redis"
else
  echo "GAGAL: kode = $actual (harapan $expected), replika = $n"; exit 1
fi
