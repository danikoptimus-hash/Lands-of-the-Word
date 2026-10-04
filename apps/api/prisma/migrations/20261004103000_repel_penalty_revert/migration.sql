-- Отмена личного штрафа за отбитые вызовы (решение владельца 04.10, уточнение): следующий вызов — уровень + 5 для всех команд одинаково.
-- Снимаем +5 за каждый отбитый вызов, добавленные миграцией 20261004100000.
UPDATE "TeamCityState" s SET "attackPenalty" = GREATEST(0, s."attackPenalty" - 5 * r.cnt)
FROM (SELECT "attackerId", "nodeKey", count(*) AS cnt FROM "Battle" WHERE status = 'REPELLED' GROUP BY "attackerId", "nodeKey") r
WHERE s."teamId" = r."attackerId" AND s."nodeKey" = r."nodeKey";
