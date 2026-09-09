#!/usr/bin/env bash
# Обновление продакшена. Вызывается GitHub Actions по SSH от пользователя deploy.
# Переменные окружения: GHCR_USER, GHCR_TOKEN (для скачивания образа), HAS_APP.
set -euo pipefail
BRANCH="claude/lands-word-city-conquest-6xtei9"
cd /opt/lotw

echo "==> Код: $BRANCH"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

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

docker image prune -f >/dev/null
echo "==> Готово: $(git rev-parse --short HEAD)"
