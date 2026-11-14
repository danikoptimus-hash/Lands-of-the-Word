-- Приоритет капитана у дела (решение владельца 14.11): капитан или заместитель отмечает дело приоритетным, свиток на карте горит.
ALTER TABLE "TeamEdgeTask" ADD COLUMN "priorityAt" TIMESTAMP(3), ADD COLUMN "priorityById" TEXT;
