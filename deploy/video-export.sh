#!/usr/bin/env bash
# Выгрузка одной партии для ролика об игре (решение владельца 08.11). Запускает владелец на сервере от root.
# Что делает:
#   1. Копирует базу прода во временную базу lotw_video (тот же контейнер lotw-db), без метрик интерфейса.
#   2. В копии оставляет только выбранную партию и обезличивает её: участники — «Участник N», администраторы —
#      «Администратор N», без почты, паролей, входа через Google, сессий, push-подписок, приглашений, обращений
#      в поддержку и настроек платформы; без ссылок на видео и свободного текста участников; имена адресатов дел —
#      «Человек N». Замечания администратора к стихам и стене остаются (по ним виден ход испытаний).
#   3. Снимает дамп копии в /root/lotw-video-<дата>.sql.gz и удаляет временную базу. Прод не меняется.
#   4. Если переданы файлы (запись экрана и т. п.), кладёт их вместе с дампом во временную папку со случайным
#      именем на тестовом стенде и печатает адреса для скачивания. Папка удаляется сама через 12 часов
#      (или сразу: команда печатается в конце).
# Запуск:  bash /root/video-export.sh "Бич народов" /root/video1.mp4 /root/video2.mp4   (имя партии, её id или название команды)
set -euo pipefail
GAME="${1:-Осень}"; shift || true
STAMP="$(date +%F-%H%M)"
OUT="/root/lotw-video-$STAMP.sql.gz"
DB=lotw_video
PG="docker exec -i lotw-db psql -U lotw -v ON_ERROR_STOP=1 -q"

# Партию можно указать именем, id или названием любой её команды. Одноимённых партий бывает несколько (тестовые) —
# сначала совпадение по команде, затем самая активная (больше записей в летописи).
echo "==> Партии на сервере (имя | статус | старт | команды | записей в летописи):"
docker exec lotw-db psql -U lotw -d lotw -At -F ' | ' -c "SELECT g.name, g.status, g.\"startedAt\"::date, (SELECT string_agg(t.name, ', ' ORDER BY t.index) FROM \"Team\" t WHERE t.\"gameId\" = g.id), (SELECT count(*) FROM \"Journal\" j WHERE j.\"gameId\" = g.id) FROM \"Game\" g WHERE g.\"deletedAt\" IS NULL ORDER BY g.\"createdAt\"" | sed 's/^/    /'
BYTEAM="EXISTS (SELECT 1 FROM \"Team\" t WHERE t.\"gameId\" = g.id AND t.name = '$GAME')"
GID="$(docker exec lotw-db psql -U lotw -d lotw -At -c "SELECT g.id FROM \"Game\" g WHERE g.\"deletedAt\" IS NULL AND (g.id = '$GAME' OR g.name = '$GAME' OR $BYTEAM) ORDER BY ($BYTEAM) DESC, (SELECT count(*) FROM \"Journal\" j WHERE j.\"gameId\" = g.id) DESC LIMIT 1")"
[ -n "$GID" ] || { echo "Партия «$GAME» не найдена"; exit 1; }
echo "==> Выгружаю: $(docker exec lotw-db psql -U lotw -d lotw -At -c "SELECT name || ' (' || id || '), команды: ' || (SELECT string_agg(t.name, ', ' ORDER BY t.index) FROM \"Team\" t WHERE t.\"gameId\" = g.id) FROM \"Game\" g WHERE id = '$GID'")"

echo "==> Временная копия базы"
docker exec lotw-db dropdb -U lotw --if-exists "$DB"
docker exec lotw-db createdb -U lotw "$DB"
docker exec lotw-db sh -c "pg_dump -U lotw -d lotw --no-owner --exclude-table-data='\"UiMetric\"' --exclude-table-data='\"UiAction\"' --exclude-table-data='\"Session\"' --exclude-table-data='\"PushSubscription\"' --exclude-table-data='\"EmailVerification\"' --exclude-table-data='\"PasswordReset\"' --exclude-table-data='\"AppSetting\"' | psql -q -U lotw -d $DB" > /dev/null

echo "==> Только эта партия, обезличивание"
$PG -d "$DB" -v gid="$GID" <<'SQL'
BEGIN;
-- Другие партии целиком (дела других партий держат задания дорог без каскада — сначала задания).
DELETE FROM "TeamEdgeTask" WHERE "gameId" <> :'gid';
DELETE FROM "Game" WHERE id <> :'gid';
DELETE FROM "SupportRequest"; DELETE FROM "Invite";
-- Пользователи: участники партии — «Участник N» по командам, администраторы — «Администратор N», остальные — «u<N>».
CREATE TEMP TABLE pseudo AS
  SELECT u.id, row_number() OVER (ORDER BY t.index, m."joinedAt", u.id) AS n
  FROM "User" u JOIN "Membership" m ON m."userId" = u.id JOIN "Team" t ON t.id = m."teamId";
CREATE TEMP TABLE pseudo_admin AS
  SELECT a."userId" AS id, row_number() OVER (ORDER BY a."userId") AS n FROM "GameAdmin" a WHERE a."userId" NOT IN (SELECT id FROM pseudo);
UPDATE "User" SET nickname = 'u' || substr(md5(id), 1, 10), "displayName" = NULL;
UPDATE "User" u SET nickname = 'p' || p.n, "displayName" = 'Участник ' || p.n FROM pseudo p WHERE p.id = u.id;
UPDATE "User" u SET nickname = 'admin' || p.n, "displayName" = 'Администратор ' || p.n FROM pseudo_admin p WHERE p.id = u.id;
UPDATE "User" SET email = NULL, "emailVerified" = false, "googleId" = NULL, "passwordHash" = 'disabled', "avatarId" = NULL, "failedLogins" = 0, "lockedUntil" = NULL;
-- Фото людей не выгружаем; значки команд остаются.
DELETE FROM "Avatar" WHERE id NOT IN (SELECT "avatarId" FROM "Team" WHERE "avatarId" IS NOT NULL);
-- Адресаты дел и получатели — без имён.
UPDATE "DeedPerson" d SET name = 'Человек ' || x.n FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM "DeedPerson") x WHERE x.id = d.id;
UPDATE "Recipient" r SET label = 'Адресат ' || x.n FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM "Recipient") x WHERE x.id = r.id;
-- Ссылки на видео и свободный текст участников.
UPDATE "TeamEdgeTask" SET links = '{}', note = '', "adminComment" = '';
UPDATE "BattleEntry" SET links = '{}', note = '';
UPDATE "WallBlock" SET links = '{}', note = '';
UPDATE "QuarryWork" SET links = '{}', note = '', "adminComment" = '';
UPDATE "WreckWork" SET links = '{}', note = '', "adminComment" = '';
UPDATE "CityVisit" SET links = '{}', text = '', "adminComment" = '';
UPDATE "PassageRequest" SET message = '', answer = '';
UPDATE "CityTrade" SET message = '';
UPDATE "TeamMark" SET note = '';
UPDATE "Membership" SET "deedsFrozenReason" = NULL;
-- Летопись: имя участника — его псевдоним, свободный текст убран.
UPDATE "Journal" j SET vars = jsonb_set(j.vars::jsonb, '{user}', to_jsonb(coalesce(u."displayName", 'Участник'))) FROM "User" u WHERE u.id = j."userId" AND j.vars::jsonb ? 'user';
UPDATE "Journal" SET vars = jsonb_set(vars::jsonb, '{user}', '"Участник"') WHERE "userId" IS NULL AND vars::jsonb ? 'user';
UPDATE "Journal" SET vars = vars::jsonb - 'who' - 'comment' - 'message' - 'answer' - 'why' - 'reason';
COMMIT;
SQL

echo "==> Дамп"
docker exec lotw-db pg_dump -U lotw -d "$DB" --no-owner | gzip > "$OUT"
docker exec lotw-db dropdb -U lotw "$DB"
chmod 600 "$OUT"
echo "    $OUT ($(du -h "$OUT" | cut -f1))"

# Временная папка на стенде: случайное имя, только чтение, сама удаляется через 12 часов.
TOKEN="drop-$(openssl rand -hex 16)"
DIR="/app/apps/web/dist/$TOKEN"
docker exec -u root lotw-app-test mkdir -p "$DIR"
for f in "$OUT" "$@"; do
  [ -f "$f" ] || { echo "нет файла: $f"; continue; }
  docker cp "$f" "lotw-app-test:$DIR/$(basename "$f")"
done
docker exec -u root lotw-app-test chmod -R a+rX "$DIR"
nohup sh -c "sleep 43200; docker exec -u root lotw-app-test rm -rf '$DIR'" > /dev/null 2>&1 &
echo "==> Готово. Пришлите в чат эту строку:"
echo "    ВЫГРУЗКА: https://test.landsoftheword.com/$TOKEN/  файлы: $(basename "$OUT") $(for f in "$@"; do [ -f "$f" ] && printf '%s ' "$(basename "$f")"; done)"
echo "    Папка удалится сама через 12 часов. Удалить сразу:  docker exec -u root lotw-app-test rm -rf '$DIR'"
