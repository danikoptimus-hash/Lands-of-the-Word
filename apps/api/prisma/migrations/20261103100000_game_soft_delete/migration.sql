-- Завершённая игра, удалённая администратором, остаётся у участников (решение владельца 03.11).
ALTER TABLE "Game" ADD COLUMN "deletedAt" TIMESTAMP(3);
