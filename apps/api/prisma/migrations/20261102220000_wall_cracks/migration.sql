-- Из блока стены в ответ берутся только недостающие стихи; надломленный блок чинится досдачей (решение владельца 02.11).
ALTER TABLE "WallBlock" ADD COLUMN "missing" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WallBlock" ADD COLUMN "repairOfId" TEXT;
