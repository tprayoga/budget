#!/usr/bin/env bash
# Pasang jadwal cron (default 02:00 WIB) lalu jalankan crond di foreground.
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY wajib}" "${RESTIC_PASSWORD:?RESTIC_PASSWORD wajib}"
echo "${BACKUP_CRON} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
# check integritas mingguan (Minggu 04:00 WIB, 10% data)
echo "0 4 * * 0 /usr/local/bin/check.sh >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
[ -f /state/started ] || date +%s > /state/started
echo "{\"level\":\"info\",\"msg\":\"backup scheduler aktif\",\"cron\":\"${BACKUP_CRON}\",\"tz\":\"${TZ}\"}"
exec crond -f -l 8
