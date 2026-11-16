#!/usr/bin/env bash
# Проверка настроек прокси на настоящем Caddy — том же образе с модулем ограничения запросов, что стоит на сервере:
# 1) файл читается (caddy validate); 2) пороги считаются как задумано (limits-test.mjs: за прокси — заглушка вместо игры).
# Запускается в конвейере выкладки стенда и прода; на сервере ничего не трогает.
#   deploy/caddy/limits-test.sh [ОБРАЗ]
set -euo pipefail
IMAGE="${1:-ghcr.io/danikoptimus-hash/lotw-caddy:latest}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NET=lotw-limits-check
cleanup() { docker rm -f lotw-app lotw-limits-proxy >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run --rm -e DOMAIN=example.org -v "$HERE/Caddyfile:/etc/caddy/Caddyfile:ro" "$IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker network create "$NET" >/dev/null
# Заглушка вместо игры: на любой запрос отвечает 200 (имя контейнера — как у приложения в Caddyfile).
docker run -d --name lotw-app --network "$NET" "$IMAGE" caddy respond --listen :3000 --body ok >/dev/null
docker run -d --name lotw-limits-proxy --network "$NET" -p 127.0.0.1:8443:443 -e DOMAIN=localhost -v "$HERE/Caddyfile:/etc/caddy/Caddyfile:ro" "$IMAGE" >/dev/null
if ! node "$HERE/limits-test.mjs" 8443; then
  echo "--- журнал прокси ---"; docker logs --tail 40 lotw-limits-proxy 2>&1 || true
  exit 1
fi
