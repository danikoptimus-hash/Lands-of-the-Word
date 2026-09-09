# Развёртывание

## Первичная настройка сервера (один раз)

На сервере от root:

```
curl -fsSL https://raw.githubusercontent.com/danikoptimus-hash/Lands-of-the-Word/claude/lands-word-city-conquest-6xtei9/deploy/bootstrap.sh -o bootstrap.sh
bash bootstrap.sh landsoftheword.com
```

Скрипт идемпотентный: повторный запуск безопасен. Что он делает — в шапке `bootstrap.sh`.

## Обновление заглушки или конфигурации Caddy

```
ssh deploy@СЕРВЕР
cd /opt/lotw && git pull --ff-only
cd deploy && docker compose up -d
```

## Логи

```
docker logs -f lotw-caddy
```
