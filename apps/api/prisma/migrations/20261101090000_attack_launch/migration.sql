-- Капитан претендентов начинает атаку сам после одобрения вызова (решение владельца 01.11).
ALTER TABLE "Battle" ADD COLUMN "attackLaunchedAt" TIMESTAMP(3);
