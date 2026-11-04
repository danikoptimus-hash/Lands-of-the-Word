-- Груз разбитого корабля задаётся в самом деле (решение владельца 05.11: «для каждого дела индивидуально»), а не в настройках игры; у корабля — снимок.
ALTER TABLE "Deed" ADD COLUMN "wreckStones" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Deed" ADD COLUMN "wreckBlocks" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Wreck" ADD COLUMN "stones" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Wreck" ADD COLUMN "blocks" INTEGER NOT NULL DEFAULT 2;
