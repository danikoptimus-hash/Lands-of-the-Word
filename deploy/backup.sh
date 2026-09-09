#!/usr/bin/env bash
# Ежедневный дамп базы. Хранит 14 последних копий в /opt/lotw-backups.
set -euo pipefail
DIR=/opt/lotw-backups
mkdir -p "$DIR"
cd /opt/lotw/deploy
docker compose exec -T db pg_dump -U lotw -d lotw --no-owner | gzip > "$DIR/lotw-$(date +%F-%H%M).sql.gz"
ls -1t "$DIR"/lotw-*.sql.gz | tail -n +15 | xargs -r rm --
