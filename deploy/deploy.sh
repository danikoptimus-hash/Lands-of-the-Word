#!/usr/bin/env bash
# Обновление продакшена. Вызывается GitHub Actions по SSH от пользователя deploy.
# Переменные окружения: GHCR_USER, GHCR_TOKEN (для скачивания образа), HAS_APP.
set -euo pipefail
BRANCH="main"
cd /opt/lotw

# Одна выкладка на сервере за раз (ревизия 15.11): прод и стенд живут на одном сервере, и две выкладки, скачивающие образы
# одновременно, падали с «lease does not exist». Вторая выкладка теперь ждёт первую (не дольше 15 минут).
# Замок — на каталоге прода: он есть всегда и читается любым пользователем (файл в /tmp, созданный от root, закрыл бы путь deploy).
if command -v flock >/dev/null; then
  exec 9</opt/lotw
  flock -w 900 9 || { echo "другая выкладка идёт дольше 15 минут — останавливаюсь"; exit 1; }
fi

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
  echo "==> Скачивание образа приложения"
  # Только приложение (ревизия 15.11): раньше скачивались свежие образы всего набора, и база или прокси могли обновиться
  # и перезапуститься посреди дня при обычной выкладке. Их обновляют отдельно и осознанно — см. deploy/README.md.
  (cd deploy && docker compose pull --quiet app)
fi

# Миграции — до запуска нового образа: иначе сервер стартует раньше, чем появятся новые таблицы.
if [[ "${HAS_APP:-false}" == "true" ]] && grep -q '^  app:' deploy/docker-compose.yml; then
  echo "==> База и миграции"
  (cd deploy && docker compose up -d db)
  # Копия базы перед каждым обновлением прода: откат — deploy/restore.sh <файл>.
  if docker exec lotw-db pg_isready -U lotw -d lotw -q 2>/dev/null; then bash deploy/backup.sh && echo "бэкап перед обновлением: $(ls -1t /opt/lotw-backups/lotw-*.sql.gz | head -1)"; fi
  # Миграции не применились — выкладка останавливается здесь (ревизия 15.11): прежняя версия продолжает работать, запуск в
  # GitHub Actions краснеет. Раньше новая версия запускалась на старой базе и сыпала ошибками в самых разных местах.
  (cd deploy && docker compose run --rm --no-deps app npm run db:migrate) || { echo "миграции не применились: смотри вывод выше; новая версия НЕ запущена"; exit 1; }
fi

echo "==> Запуск"
(cd deploy && docker compose up -d --remove-orphans)
# Настройки прокси. Caddyfile смонтирован в контейнер одним файлом: git при обновлении заменяет файл новым, а контейнер
# продолжает видеть прежний — «перечитать настройки» читало бы старое содержимое, и правка Caddyfile не начинала действовать
# (находка независимого разбора 15.11). Поэтому: если файл в контейнере отличается от файла в репозитории, новый сначала
# проверяет сам Caddy, и только после удачной проверки прокси перезапускается — тогда он видит новый файл. Это несколько
# секунд без связи у прода и стенда, и только в ту выкладку, которая меняет настройки прокси. Не прошёл проверку —
# прокси остаётся на прежних настройках, выкладка помечается неудачной в конце.
CADDY_OK=1
if docker ps --format '{{.Names}}' | grep -qx lotw-caddy; then
  if ! docker exec lotw-caddy cat /etc/caddy/Caddyfile 2>/dev/null | cmp -s - deploy/caddy/Caddyfile; then
    echo "==> Настройки прокси изменились: проверка и перезапуск прокси"
    if docker cp deploy/caddy/Caddyfile lotw-caddy:/tmp/Caddyfile.new >/dev/null && docker exec lotw-caddy caddy validate --config /tmp/Caddyfile.new --adapter caddyfile >/dev/null 2>&1; then
      (cd deploy && docker compose restart caddy)
    else
      CADDY_OK=0; echo "новый Caddyfile не прошёл проверку: прокси оставлен на прежних настройках"
      docker exec lotw-caddy caddy validate --config /tmp/Caddyfile.new --adapter caddyfile 2>&1 | tail -5 || true
    fi
  fi
fi

echo "==> Ежедневный бэкап базы (cron 03:30)"
mkdir -p /opt/lotw-backups
if command -v crontab >/dev/null; then
  { crontab -l 2>/dev/null | grep -v lotw/deploy/backup.sh || true; echo "30 3 * * * /opt/lotw/deploy/backup.sh >> /opt/lotw-backups/backup.log 2>&1"; } | crontab - \
    || echo "не удалось записать crontab (проверь: apt install cron; usermod -aG crontab deploy)"
else
  echo "crontab не установлен: бэкап по расписанию не настроен (apt install cron)"
fi

# Чистка старых образов не должна ронять выкладку: контейнер уже поднят, а параллельная чистка отвечает «a prune operation is already running».
docker image prune -f >/dev/null 2>&1 || true
echo "==> Готово: $(git rev-parse --short HEAD)"
if [[ "$CADDY_OK" == 0 ]]; then echo "ВНИМАНИЕ: настройки прокси не применены — см. сообщение проверки выше"; exit 1; fi
