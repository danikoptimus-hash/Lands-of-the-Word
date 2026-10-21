-- Организация убрана из игры совсем (решение владельца 21.10): поле «Церковь» сняли ещё 20.09, запись оставалась
-- в базе с названием по умолчанию и показывалась только на странице «Все игры». Теперь её нет нигде.
ALTER TABLE "Game" DROP CONSTRAINT "Game_orgId_fkey";
ALTER TABLE "Game" DROP COLUMN "orgId";
DROP TABLE "Organization";
