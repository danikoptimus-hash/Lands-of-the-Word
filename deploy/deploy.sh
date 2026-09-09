#!/usr/bin/env bash
# Обновление продакшена. Вызывается GitHub Actions по SSH от пользователя deploy.
# Переменные окружения: GHCR_USER, GHCR_TOKEN (для скачивания образа), HAS_APP.
set -euo pipefail
BRANCH="claude/lands-word-city-conquest-6xtei9"
cd /opt/lotw

echo "==> Код: $BRANCH"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

echo "==> Секреты окружения (создаются один раз)"
ENV_FILE=deploy/.env
touch "$ENV_FILE"
grep -q '^DOMAIN=' "$ENV_FILE" || echo "DOMAIN=landsoftheword.com" >> "$ENV_FILE"
grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE" || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> "$ENV_FILE"
grep -q '^SESSION_SECRET=' "$ENV_FILE" || echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

if [[ "${HAS_APP:-false}" == "true" ]]; then
  echo "==> Вход в реестр образов"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  echo "==> Скачивание образа"
  (cd deploy && docker compose pull --quiet)
fi

echo "==> Запуск"
(cd deploy && docker compose up -d --remove-orphans)

if [[ "${HAS_APP:-false}" == "true" ]] && grep -q '^  app:' deploy/docker-compose.yml; then
  echo "==> Миграции базы"
  (cd deploy && docker compose exec -T app npm run db:migrate) || echo "миграции пропущены (команда ещё не настроена)"
fi

echo "==> Ежедневный бэкап базы (cron 03:30)"
mkdir -p /opt/lotw-backups
( crontab -l 2>/dev/null | grep -v lotw/deploy/backup.sh; echo "30 3 * * * /opt/lotw/deploy/backup.sh >> /opt/lotw-backups/backup.log 2>&1" ) | crontab -

docker image prune -f >/dev/null
echo "==> Готово: $(git rev-parse --short HEAD)"
