#!/usr/bin/env bash
# Обновление тестового стенда (test.<домен>). Вызывается GitHub Actions по SSH после пуша в ветку staging.
# Переменные окружения: GHCR_USER, GHCR_TOKEN (для скачивания образа). Каталог стенда — ~/lotw-test пользователя deploy (в /opt писать нельзя).
set -euo pipefail
BRANCH="staging"
DIR="$HOME/lotw-test"
PROD_DIR=/opt/lotw

# Одна выкладка на сервере за раз (ревизия 15.11): прод и стенд живут на одном сервере, и две выкладки, скачивающие образы
# одновременно, падали с «lease does not exist». Вторая выкладка теперь ждёт первую (не дольше 15 минут).
# Замок — на каталоге прода: он есть всегда и читается любым пользователем (файл в /tmp, созданный от root, закрыл бы путь deploy).
if command -v flock >/dev/null; then
  exec 9</opt/lotw
  flock -w 900 9 || { echo "другая выкладка идёт дольше 15 минут — останавливаюсь"; exit 1; }
fi

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
# Только образ приложения: база стенда не обновляется сама при обычной выкладке (как и на проде).
$C pull --quiet app-test

echo "==> Убираю контейнеры стенда прежних имён (после переименования сервисов они мешают и держат псевдонимы app/db в сети)"
$C down --remove-orphans >/dev/null 2>&1 || true
docker rm -f lotw-app-test lotw-db-test >/dev/null 2>&1 || true

echo "==> База и миграции"
$C up -d db-test
# База стенда пересоздаётся при каждой выкладке — ждём её готовности, иначе миграции стартуют раньше базы.
for _ in $(seq 1 40); do docker exec lotw-db-test pg_isready -U lotw -d lotw -q 2>/dev/null && break; sleep 1; done
docker exec lotw-db-test pg_isready -U lotw -d lotw -q 2>/dev/null || echo "база стенда не ответила за 40 секунд — миграции, скорее всего, не пройдут: смотри docker logs lotw-db-test"
# Контейнеры стенда выше уже убраны, прежней версии нет: при ошибке миграции стенд всё равно поднимается (иначе он
# лежал бы до следующей удачной выкладки), а выкладка помечается неудачной в самом конце.
MIGRATED=1
$C run --rm --no-deps app-test npm run db:migrate || { MIGRATED=0; echo "миграции не применились: смотри вывод выше"; }

echo "==> Запуск"
$C up -d --remove-orphans
# Чистка старых образов не должна ронять выкладку: контейнер уже поднят, а параллельная чистка отвечает «a prune operation is already running».
docker image prune -f >/dev/null 2>&1 || true
# Что за сервер (для решений о нагрузке; раньше это приходилось спрашивать у владельца): ядра, память, часы.
echo "==> Сервер: ядер $(nproc 2>/dev/null || echo '?'), память $(free -m 2>/dev/null | awk 'NR==2{print $2" МБ, занято "$3" МБ"}'), часы сервера $(date +'%H:%M %Z')"
echo "==> Готово: стенд $(git rev-parse --short HEAD)"
if [[ "$MIGRATED" == 0 ]]; then echo "ВНИМАНИЕ: миграции не применились — стенд запущен на прежней структуре базы"; exit 1; fi
