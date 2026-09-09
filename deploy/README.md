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

## Автодеплой (GitHub Actions)

Каждый push в рабочую ветку (кроме правок только в `docs/`, `assets/raw/`, `*.md`) запускает `.github/workflows/deploy.yml`:
1. собирает Docker-образ приложения и публикует в GitHub Container Registry `ghcr.io/danikoptimus-hash/lotw-app` (шаг пропускается, пока в репозитории нет `Dockerfile`);
2. по SSH заходит на сервер пользователем `deploy` и запускает `deploy/deploy.sh`: обновляет код, скачивает образ, перезапускает контейнеры, применяет миграции.

Нужные секреты репозитория (Settings → Secrets and variables → Actions → New repository secret):

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | IP сервера |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | приватный ключ, специально созданный для деплоя (см. ниже) |

Создание ключа деплоя — на сервере от root:

```
ssh-keygen -t ed25519 -N "" -C "github-deploy" -f /root/deploykey
cat /root/deploykey.pub >> /home/deploy/.ssh/authorized_keys
cat /root/deploykey
```

Вывод последней команды (от `-----BEGIN OPENSSH PRIVATE KEY-----` до `-----END OPENSSH PRIVATE KEY-----` включительно) вставить в секрет `DEPLOY_SSH_KEY`, после чего удалить файлы: `rm /root/deploykey /root/deploykey.pub`.

Запуск вручную: вкладка Actions → deploy → Run workflow.
