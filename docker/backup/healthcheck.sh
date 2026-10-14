#!/usr/bin/env bash
# Sehat bila backup terakhir < 26 jam lalu (atau container baru < 26 jam dan belum pernah backup).
set -euo pipefail
now=$(date +%s); limit=$((26 * 3600))
if [ -f /state/last_success ]; then [ $((now - $(cat /state/last_success))) -lt $limit ]; exit; fi
[ -f /state/started ] && [ $((now - $(cat /state/started))) -lt $limit ]
