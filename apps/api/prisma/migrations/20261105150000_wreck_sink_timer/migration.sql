-- Срок затопления разбитого корабля (решение владельца 05.11): задаётся в деле, у корабля — снимок; по сроку корабль тонет сам.
ALTER TABLE "Deed" ADD COLUMN "wreckSinkAt" TIMESTAMP(3);
ALTER TABLE "Wreck" ADD COLUMN "sinkAt" TIMESTAMP(3);
