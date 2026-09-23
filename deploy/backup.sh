#!/usr/bin/env bash
# Дамп базы: ежедневно по cron и перед каждым обновлением прода. Хранит 30 последних копий в /opt/lotw-backups.
set -euo pipefail
DIR=/opt/lotw-backups
mkdir -p "$DIR"
cd /opt/lotw/deploy
docker compose exec -T db pg_dump -U lotw -d lotw --no-owner | gzip > "$DIR/lotw-$(date +%F-%H%M).sql.gz"
ls -1t "$DIR"/lotw-*.sql.gz | tail -n +31 | xargs -r rm --
