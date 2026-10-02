-- Ценник пожертвования у каждого дела свой (решение владельца 02.10): общая настройка игры переносится в дела.
ALTER TABLE "Deed" ADD COLUMN "donationMin" INTEGER;
UPDATE "Deed" d SET "donationMin" = (g.settings->>'donationMin')::INTEGER
  FROM "Game" g
  WHERE g.id = d."gameId" AND g.settings->>'donationMin' ~ '^[0-9]+$' AND (g.settings->>'donationMin')::INTEGER > 0;
