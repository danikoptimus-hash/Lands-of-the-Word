#!/usr/bin/env bash
# Дамп базы: ежедневно по cron и перед каждым обновлением прода. Хранит 30 последних копий в /opt/lotw-backups.
set -euo pipefail
DIR=/opt/lotw-backups
mkdir -p "$DIR"
cd /opt/lotw/deploy
# Низкий приоритет (ревизия скорости, этап 2): снятие и сжатие копии не отнимают процессор у игры.
docker compose exec -T db nice -n 19 pg_dump -U lotw -d lotw --no-owner | nice -n 19 gzip > "$DIR/lotw-$(date +%F-%H%M).sql.gz"
ls -1t "$DIR"/lotw-*.sql.gz | tail -n +31 | xargs -r rm --
