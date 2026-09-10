#!/usr/bin/env bash
# Восстановление базы из дампа (/opt/lotw-backups/lotw-ДАТА.sql.gz).
# Использование: bash deploy/restore.sh /opt/lotw-backups/lotw-2026-09-10-0330.sql.gz
# Останавливает приложение, пересоздаёт базу, заливает дамп, запускает приложение.
set -euo pipefail
DUMP=${1:?Укажите файл дампа .sql.gz}
[ -f "$DUMP" ] || { echo "Нет файла: $DUMP"; exit 1; }
cd /opt/lotw/deploy
echo "Останавливаю приложение…"
docker compose stop app
echo "Пересоздаю базу lotw…"
docker compose exec -T db psql -U lotw -d postgres -c "DROP DATABASE IF EXISTS lotw;" -c "CREATE DATABASE lotw OWNER lotw;"
echo "Заливаю дамп $DUMP…"
gunzip -c "$DUMP" | docker compose exec -T db psql -U lotw -d lotw -q
echo "Запускаю приложение (миграции применятся сами)…"
docker compose up -d app
sleep 5
curl -fsS http://127.0.0.1:3000/api/health || docker compose logs --tail 30 app
echo "Готово."
