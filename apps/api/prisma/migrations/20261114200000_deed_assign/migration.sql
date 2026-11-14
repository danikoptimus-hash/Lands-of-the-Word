-- Поручение дела (решение владельца 14.11): капитан или заместитель поручает свободное дело участнику; бронь держится сутки.
ALTER TABLE "TeamEdgeTask" ADD COLUMN "assignedToId" TEXT, ADD COLUMN "assignedById" TEXT, ADD COLUMN "assignedAt" TIMESTAMP(3);
