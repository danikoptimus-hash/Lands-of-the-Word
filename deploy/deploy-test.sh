#!/usr/bin/env bash
# Обновление тестового стенда (test.<домен>). Вызывается GitHub Actions по SSH после пуша в ветку staging.
# Переменные окружения: GHCR_USER, GHCR_TOKEN (для скачивания образа).
set -euo pipefail
BRANCH="staging"
DIR=/opt/lotw-test
PROD_DIR=/opt/lotw

if [[ ! -d "$DIR/.git" ]]; then
  echo "==> Первый запуск: клон репозитория в $DIR"
  git clone --quiet --branch "$BRANCH" "$(git -C "$PROD_DIR" remote get-url origin)" "$DIR"
fi
cd "$DIR"
echo "==> Код: $BRANCH"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

echo "==> Секреты стенда (создаются один раз, свои — не прод)"
ENV_FILE=deploy/.env.test
touch "$ENV_FILE"
DOMAIN=$(grep '^DOMAIN=' "$PROD_DIR/deploy/.env" | cut -d= -f2-)
grep -q '^DOMAIN=' "$ENV_FILE" || echo "DOMAIN=${DOMAIN:-landsoftheword.com}" >> "$ENV_FILE"
grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE" || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> "$ENV_FILE"
grep -q '^SESSION_SECRET=' "$ENV_FILE" || echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENV_FILE"
# Сеть прод-стека: по ней Caddy находит контейнер стенда.
PROD_NET=$(docker inspect lotw-caddy -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || echo deploy_default)
grep -q '^PROD_NET=' "$ENV_FILE" && sed -i "s|^PROD_NET=.*|PROD_NET=$PROD_NET|" "$ENV_FILE" || echo "PROD_NET=$PROD_NET" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

C="docker compose -p lotw-test -f deploy/docker-compose.test.yml --env-file deploy/.env.test"

echo "==> Вход в реестр образов и скачивание образа :test"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
$C pull --quiet

echo "==> База и миграции"
$C up -d db
$C run --rm --no-deps app npm run db:migrate || echo "миграции не применились: смотри вывод выше"

echo "==> Запуск"
$C up -d --remove-orphans
docker image prune -f >/dev/null
echo "==> Готово: стенд $(git rev-parse --short HEAD)"
