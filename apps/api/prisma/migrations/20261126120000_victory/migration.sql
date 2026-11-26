-- Празднование победы (решение владельца 26.11): момент взятия последней столицы и команда-победитель; партия идёт ещё трое суток.
ALTER TABLE "Game" ADD COLUMN "victoryAt" TIMESTAMP(3), ADD COLUMN "victoryTeamId" TEXT;
