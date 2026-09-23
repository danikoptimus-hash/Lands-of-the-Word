#!/usr/bin/env bash
# Копия боевой базы на тестовый стенд: чтобы проверять обновления на реальных командах и городах, не трогая прод.
# Запуск: GitHub Actions «copy-db-to-test» (кнопка Run workflow) или вручную: bash ~/lotw-test/deploy/copy-db-to-test.sh
# Что убирает из копии: подписки на push-уведомления и ключи push (стенд заведёт свои) — чтобы стенд ничего не слал игрокам.
# Почта на стенде выключена в docker-compose.test.yml.
set -euo pipefail
cd "$HOME/lotw-test"
C="docker compose -p lotw-test -f deploy/docker-compose.test.yml --env-file deploy/.env.test"
DUMP=$(mktemp /tmp/lotw-prod-XXXX.sql)
trap 'rm -f "$DUMP"' EXIT

echo "==> Дамп прода"
docker exec lotw-db pg_dump -U lotw -d lotw --no-owner > "$DUMP"

echo "==> Останавливаю приложение стенда, пересоздаю базу"
$C stop app
$C up -d db
docker exec lotw-db-test psql -U lotw -d postgres -q -c "DROP DATABASE IF EXISTS lotw;" -c "CREATE DATABASE lotw OWNER lotw;"
docker exec -i lotw-db-test psql -U lotw -d lotw -q < "$DUMP"

echo "==> Чищу то, что не должно работать со стенда"
docker exec lotw-db-test psql -U lotw -d lotw -q \
  -c 'DELETE FROM "PushSubscription";' \
  -c "DELETE FROM \"AppSetting\" WHERE key LIKE 'vapid.%';"

echo "==> Миграции стенда (образ стенда может быть новее прода) и запуск"
$C run --rm --no-deps app npm run db:migrate
$C up -d app
sleep 5
docker exec lotw-app-test wget -qO- http://127.0.0.1:3000/api/health || $C logs --tail 30 app
echo "==> Готово: на стенде копия прода от $(date +%F\ %H:%M)"
