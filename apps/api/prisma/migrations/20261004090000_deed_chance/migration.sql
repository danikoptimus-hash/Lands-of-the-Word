-- Вероятность появления дела в процентах с шагом 20 вместо трёх ступеней частоты (решение владельца 04.10).
ALTER TABLE "Deed" ADD COLUMN "chance" INTEGER NOT NULL DEFAULT 60;
UPDATE "Deed" SET "chance" = CASE "frequency" WHEN 1 THEN 20 WHEN 3 THEN 100 ELSE 60 END;
ALTER TABLE "Deed" DROP COLUMN "frequency";
