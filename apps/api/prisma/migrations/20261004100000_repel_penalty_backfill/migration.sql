-- Отбитый вызов дорожает на 5 для атаковавшей команды (решение владельца 04.10): штраф задним числом за уже отбитые вызовы.
UPDATE "TeamCityState" s SET "attackPenalty" = s."attackPenalty" + 5 * r.cnt
FROM (SELECT "attackerId", "nodeKey", count(*) AS cnt FROM "Battle" WHERE status = 'REPELLED' GROUP BY "attackerId", "nodeKey") r
WHERE s."teamId" = r."attackerId" AND s."nodeKey" = r."nodeKey";
INSERT INTO "TeamCityState" ("id", "gameId", "teamId", "nodeKey", "attackPenalty")
SELECT md5(random()::text || b."attackerId" || b."nodeKey"), b."gameId", b."attackerId", b."nodeKey", 5 * count(*)
FROM "Battle" b
WHERE b.status = 'REPELLED' AND NOT EXISTS (SELECT 1 FROM "TeamCityState" s WHERE s."teamId" = b."attackerId" AND s."nodeKey" = b."nodeKey")
GROUP BY b."gameId", b."attackerId", b."nodeKey";
