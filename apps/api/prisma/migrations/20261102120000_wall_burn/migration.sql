-- Блок стены, легший в ответ, сгорает (решение владельца 02.11): стена тает на использованные блоки.
ALTER TABLE "WallBlock" ADD COLUMN "usedBattleId" TEXT;
ALTER TABLE "WallBlock" ADD COLUMN "usedAt" TIMESTAMP(3);
