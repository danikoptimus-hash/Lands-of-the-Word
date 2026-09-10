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

Письма уходят через SMTP. Пока в `deploy/.env` нет `SMTP_HOST`, письма не отправляются, и восстановить пароль нельзя.

### Вариант без оплаты и без настройки DNS: почтовый ящик Gmail

1. Завести отдельный ящик Gmail для сайта (например, `landsoftheword@gmail.com`), включить в нём двухэтапную проверку.
2. В настройках Google-аккаунта → «Безопасность» → «Пароли приложений» создать пароль приложения (16 символов).
3. На сервере дописать в `deploy/.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=landsoftheword@gmail.com
SMTP_PASS=пароль приложения
MAIL_FROM=Земли Слова <landsoftheword@gmail.com>
```

4. Перезапустить: `cd /opt/lotw/deploy && docker compose up -d app`.
5. Проверить: в настройках аккаунта суперадмина есть кнопка «Проверить почту» — она показывает ошибку подключения словами и шлёт тестовое письмо.

Порт **587**, а не 465: у Hetzner для новых аккаунтов исходящие порты 25 и 465 закрыты (открывают по запросу в поддержку после первого оплаченного счёта), 587 открыт.

Лимит Gmail — около 500 писем в сутки, для восстановления паролей и уведомлений хватает. Так же работают Яндекс (`smtp.yandex.ru`, 465) и Mail.ru (`smtp.mail.ru`, 465) с паролем приложения.

### Вариант «как положено»: сервис рассылок со своим доменом

Resend (бесплатно до 3 000 писем в месяц) или Mailgun: добавить домен `landsoftheword.com`, внести в DNS Porkbun записи SPF/DKIM, которые покажет сервис, взять SMTP-логин и ключ и вписать их в `deploy/.env` так же, как выше (`SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend`, `SMTP_PASS=API-ключ`, `MAIL_FROM=Земли Слова <noreply@landsoftheword.com>`).

Ключи и пароли только в `deploy/.env` на сервере, в репозиторий их не класть.

## Бэкапы и восстановление

Дамп базы делается каждый день в 03:30 (`deploy/backup.sh`, cron пользователя deploy) в `/opt/lotw-backups`, хранятся 14 последних. Проверить, что бэкапы идут:

```
ls -la /opt/lotw-backups
```

Восстановить из дампа (на сервере от root):

```
bash /opt/lotw/deploy/restore.sh /opt/lotw-backups/lotw-ГГГГ-ММ-ДД-ЧЧММ.sql.gz
```

Скрипт останавливает приложение, пересоздаёт базу, заливает дамп и запускает приложение. Рекомендуется раз в месяц проверять восстановление на копии: `docker compose exec -T db pg_restore` не нужен — дампы в формате plain SQL.
