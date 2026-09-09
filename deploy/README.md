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

## Почта (восстановление пароля, уведомления)

Письма уходят через SMTP. Пока в `deploy/.env` нет `SMTP_HOST`, письма не отправляются: страница «Забыли пароль» предлагает обратиться к администратору игры, который выдаёт ссылку сброса в списке участников команды.

Чтобы включить почту (рекомендуется Brevo, бесплатный тариф до 300 писем в день):

1. Завести аккаунт Brevo, в разделе **Senders & Domains** добавить домен `landsoftheword.com` и внести в DNS (Porkbun) записи, которые покажет Brevo (SPF, DKIM, DMARC).
2. В разделе **SMTP & API → SMTP** взять логин и SMTP-ключ.
3. На сервере дописать в `deploy/.env`:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=логин из Brevo
SMTP_PASS=SMTP-ключ из Brevo
MAIL_FROM=Земли Слова <noreply@landsoftheword.com>
```

4. Перезапустить: `cd /opt/lotw/deploy && docker compose up -d app`.

Ключи и пароли только в `deploy/.env` на сервере, в репозиторий их не класть.
