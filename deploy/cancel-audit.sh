#!/usr/bin/env bash
# Проверка отмен вызовов (решение владельца 03.11: «кто воспользовался бесплатной отменой вызовов и подбирал вызовы так,
# чтобы игра дала подходящий отрывок»). Только чтение, ничего не пишет и не выгружает: отчёт в терминал.
# Запуск на сервере от root:  bash /opt/lotw/deploy/cancel-audit.sh "Осень"
# Проверка на локальной базе:  PSQL="psql postgresql://..." bash deploy/cancel-audit.sh "Имя партии"
set -euo pipefail
GAME="${1:-Осень}"
PSQL="${PSQL:-docker exec lotw-db psql -U lotw -d lotw}"
G="(SELECT id FROM \"Game\" WHERE name = '$GAME' ORDER BY (status = 'ACTIVE') DESC, (status = 'FINISHED') DESC, \"createdAt\" DESC LIMIT 1)"
TZ_EXPR="coalesce((SELECT settings->'rules'->>'timeZone' FROM \"Game\" WHERE id = $G), 'Asia/Tashkent')"
Q() { echo; echo "==> $1"; $PSQL -v ON_ERROR_STOP=1 -c "$2"; }

echo "==> Партия «$GAME»: отмены вызовов. Время — в поясе игры. Отрывок — номера стихов книги с начала (сквозные), назначается при старте вызова; у отменённых из очереди отрывка нет."

Q "Сводка по командам: сколько вызовов бросили, сколько отменили, сколько отменили быстро (до 30 минут после старта), в скольких городах отменяли по 2 раза и больше" \
"WITH b AS (
  SELECT b.*, t.name AS team FROM \"Battle\" b JOIN \"Team\" t ON t.id = b.\"attackerId\" WHERE b.\"gameId\" = $G
), per_city AS (
  SELECT \"attackerId\", \"nodeKey\", count(*) FILTER (WHERE status = 'CANCELLED') AS cancels FROM b GROUP BY 1, 2
)
SELECT b.team AS \"команда\",
  (SELECT string_agg(u.nickname, ', ') FROM \"Membership\" m JOIN \"User\" u ON u.id = m.\"userId\" WHERE m.\"teamId\" = b.\"attackerId\" AND m.role = 'CAPTAIN') AS \"капитан\",
  count(*) AS \"вызовов\",
  count(*) FILTER (WHERE status = 'CANCELLED') AS \"отменено\",
  count(*) FILTER (WHERE status = 'CANCELLED' AND \"startedAt\" IS NOT NULL AND \"resolvedAt\" - \"startedAt\" < interval '30 minutes') AS \"отменено быстро\",
  (SELECT count(*) FROM per_city p WHERE p.\"attackerId\" = b.\"attackerId\" AND p.cancels >= 2) AS \"городов с повторами\",
  count(*) FILTER (WHERE status IN ('WON', 'REPELLED', 'DEFENSE')) AS \"дошло до ответа\"
FROM b GROUP BY b.\"attackerId\", b.team ORDER BY \"отменено\" DESC, b.team;"

Q "Цепочки подбора: города, где команда отменяла вызов 2 раза и больше, — все попытки по порядку (время старта, исход, сколько минут жил вызов, какой отрывок достался)" \
"WITH b AS (
  SELECT b.*, t.name AS team, d.name AS owner FROM \"Battle\" b JOIN \"Team\" t ON t.id = b.\"attackerId\" JOIN \"Team\" d ON d.id = b.\"defenderId\" WHERE b.\"gameId\" = $G
), rep AS (
  SELECT \"attackerId\", \"nodeKey\" FROM b GROUP BY 1, 2 HAVING count(*) FILTER (WHERE status = 'CANCELLED') >= 2
)
SELECT b.team AS \"команда\", b.\"bookCode\" AS \"город\", b.owner AS \"хранители\",
  to_char((b.\"declaredAt\" AT TIME ZONE 'UTC') AT TIME ZONE $TZ_EXPR, 'DD.MM HH24:MI') AS \"вызов\",
  to_char((b.\"startedAt\" AT TIME ZONE 'UTC') AT TIME ZONE $TZ_EXPR, 'DD.MM HH24:MI') AS \"старт\",
  b.status AS \"исход\",
  round(extract(epoch FROM (coalesce(b.\"resolvedAt\", now()) - coalesce(b.\"startedAt\", b.\"declaredAt\"))) / 60) AS \"минут\",
  b.bid AS \"ставка\",
  CASE WHEN b.\"passageStart\" IS NULL THEN '—' ELSE (b.\"passageStart\" + 1) || '–' || (b.\"passageEnd\" + 1) END AS \"отрывок (стихи с начала книги)\"
FROM b JOIN rep r ON r.\"attackerId\" = b.\"attackerId\" AND r.\"nodeKey\" = b.\"nodeKey\"
ORDER BY b.team, b.\"nodeKey\", b.\"declaredAt\";"

Q "Все отмены по порядку (кто, какой город, когда, через сколько минут после старта, отрывок)" \
"SELECT t.name AS \"команда\", b.\"bookCode\" AS \"город\",
  to_char((b.\"declaredAt\" AT TIME ZONE 'UTC') AT TIME ZONE $TZ_EXPR, 'DD.MM HH24:MI') AS \"вызов\",
  to_char((b.\"resolvedAt\" AT TIME ZONE 'UTC') AT TIME ZONE $TZ_EXPR, 'DD.MM HH24:MI') AS \"отмена\",
  round(extract(epoch FROM (b.\"resolvedAt\" - coalesce(b.\"startedAt\", b.\"declaredAt\"))) / 60) AS \"минут\",
  CASE WHEN b.\"passageStart\" IS NULL THEN '—' ELSE (b.\"passageStart\" + 1) || '–' || (b.\"passageEnd\" + 1) END AS \"отрывок\"
FROM \"Battle\" b JOIN \"Team\" t ON t.id = b.\"attackerId\"
WHERE b.\"gameId\" = $G AND b.status = 'CANCELLED' ORDER BY b.\"resolvedAt\";"
