#!/usr/bin/env bash
# Выгрузка данных одной партии для исследования поведения участников (решение владельца 02.10: никаких выгрузок через игру —
# только этот скрипт на сервере, запускает владелец). Пишет CSV по таблицам в папку и собирает архив.
# Что НЕ попадает в выгрузку: пароли (хеши), почта, сессии, ссылки сброса и подтверждения, push-подписки, настройки платформы.
# Запуск на сервере от root:  bash /opt/lotw/deploy/research-export.sh "Осень"
set -euo pipefail
GAME="${1:-Осень}"
OUT="/root/lotw-research-$(date +%F-%H%M)"
mkdir -p "$OUT"
G="(SELECT id FROM \"Game\" WHERE name = '$GAME' ORDER BY \"createdAt\" DESC LIMIT 1)"
Q() { docker exec lotw-db psql -U lotw -d lotw --csv -v ON_ERROR_STOP=1 -c "$2" > "$OUT/$1.csv"; echo "  $1.csv: $(($(wc -l < "$OUT/$1.csv") - 1)) строк"; }

echo "==> Партия «$GAME»"
Q game          "SELECT id, name, status, \"startedAt\", \"endsAt\", \"createdAt\", settings::text FROM \"Game\" WHERE id = $G"
Q teams         "SELECT id, index, name, color, \"startNodeKey\", status FROM \"Team\" WHERE \"gameId\" = $G ORDER BY index"
Q members       "SELECT m.\"teamId\", m.\"userId\", m.role, m.\"gameRole\", m.\"joinedAt\", u.nickname, u.\"displayName\", u.locale, u.\"createdAt\" AS \"userCreatedAt\", u.\"lastSeenAt\" FROM \"Membership\" m JOIN \"User\" u ON u.id = m.\"userId\" JOIN \"Team\" t ON t.id = m.\"teamId\" WHERE t.\"gameId\" = $G ORDER BY m.\"teamId\", m.\"joinedAt\""
Q journal       "SELECT id, \"teamId\", \"userId\", kind, everyone, vars::text, \"createdAt\" FROM \"Journal\" WHERE \"gameId\" = $G ORDER BY \"createdAt\""
Q task_events   "SELECT \"teamId\", \"userId\", \"nodeKey\", \"taskIndex\", kind, \"awayMs\", \"createdAt\" FROM \"TaskEvent\" WHERE \"gameId\" = $G ORDER BY \"createdAt\""
Q city_states   "SELECT \"teamId\", \"nodeKey\", \"orderSolved\", \"orderAttempts\", coalesce(array_length(\"doneTasks\", 1), 0) AS done, \"doneTasks\"::text, \"answerAttempts\", \"lastWrongAt\", \"capturedAt\", \"firstCapturedAt\", \"isCapital\", \"hintTasks\"::text, \"keyWrong\", \"createdAt\" FROM \"TeamCityState\" WHERE \"gameId\" = $G ORDER BY \"teamId\", \"createdAt\""
Q task_locks    "SELECT \"teamId\", \"nodeKey\", \"taskIndex\", wrong, \"lockedUntil\", \"createdAt\", \"updatedAt\" FROM \"TeamTaskLock\" WHERE \"gameId\" = $G ORDER BY \"updatedAt\""
Q edge_tasks    "SELECT e.id, e.\"teamId\", e.\"fromKey\", e.\"toKey\", e.status, e.sea, e.\"takenById\", e.\"takenAt\", e.\"submittedAt\", e.\"decidedAt\", e.\"decidedById\", e.donation, e.\"donationAmount\", e.participants::text, coalesce(array_length(e.links, 1), 0) AS links, e.note, e.\"adminComment\", e.\"createdAt\", d.title AS deed FROM \"TeamEdgeTask\" e JOIN \"Deed\" d ON d.id = e.\"deedId\" WHERE e.\"gameId\" = $G ORDER BY e.\"createdAt\""
Q nodes         "SELECT key, kind, \"bookCode\", \"cityType\", island, coastal, ruined FROM \"MapNode\" WHERE \"gameId\" = $G"
Q edges         "SELECT \"aKey\", \"bKey\" FROM \"MapEdge\" WHERE \"gameId\" = $G"
Q battles       "SELECT id, \"nodeKey\", \"bookCode\", \"attackerId\", \"defenderId\", status, bid, \"defenseBid\", \"declaredAt\", \"startedAt\", \"attackDeadline\", \"attackDoneAt\", \"attackApprovedAt\", \"defenseDeadline\", \"defenseDoneAt\", \"resolvedAt\" FROM \"Battle\" WHERE \"gameId\" = $G ORDER BY \"declaredAt\""
Q battle_entries "SELECT be.\"battleId\", be.side, be.\"teamId\", be.\"userId\", be.\"startIdx\", be.\"endIdx\", be.status, be.weight, be.carried, coalesce(array_length(be.links, 1), 0) AS links, be.\"createdAt\", be.\"decidedAt\" FROM \"BattleEntry\" be JOIN \"Battle\" b ON b.id = be.\"battleId\" WHERE b.\"gameId\" = $G ORDER BY be.\"createdAt\""
Q sieges        "SELECT id, \"nodeKey\", \"attackerId\", \"defenderId\", status, \"startedAt\", \"endsAt\", \"attackerPoints\", \"defenderPoints\", \"resolvedAt\" FROM \"Siege\" WHERE \"gameId\" = $G ORDER BY \"startedAt\""
Q peeks         "SELECT p.\"teamId\", p.\"nodeKey\", p.\"createdAt\" FROM \"TeamPeek\" p JOIN \"Team\" t ON t.id = p.\"teamId\" WHERE t.\"gameId\" = $G ORDER BY p.\"createdAt\""

tar czf "$OUT.tgz" -C "$(dirname "$OUT")" "$(basename "$OUT")"
rm -rf "$OUT"
echo "==> Готово: $OUT.tgz ($(du -h "$OUT.tgz" | cut -f1))"
echo "    Скачать на компьютер:  scp root@СЕРВЕР:$OUT.tgz ."
