# Backup terjadwal: pg_dump (format custom) + folder uploads → restic (terenkripsi) → object storage S3-compatible.
FROM postgres:16-alpine
RUN apk add --no-cache restic tzdata ca-certificates bash
ENV TZ=Asia/Jakarta \
    BACKUP_CRON="0 2 * * *" \
    RESTIC_CACHE_DIR=/cache
COPY backup.sh restore.sh check.sh entrypoint.sh healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh && mkdir -p /cache /state /restore
HEALTHCHECK --interval=5m --timeout=10s --retries=1 CMD /usr/local/bin/healthcheck.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
