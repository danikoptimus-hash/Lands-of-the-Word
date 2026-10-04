-- Каменоломня (решение владельца 04.10): общие дела команды дают тёсаные камни, камень мостит свободную сторону.
ALTER TABLE "Team" ADD COLUMN "stones" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Deed" ADD COLUMN "quarry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deed" ADD COLUMN "stones" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TeamEdgeTask" ADD COLUMN "paved" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "QuarryWork" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "deedId" TEXT NOT NULL,
  "byId" TEXT NOT NULL,
  "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "note" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "stones" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "adminComment" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "QuarryWork_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuarryWork_gameId_status_idx" ON "QuarryWork"("gameId", "status");
CREATE INDEX "QuarryWork_teamId_idx" ON "QuarryWork"("teamId");
ALTER TABLE "QuarryWork" ADD CONSTRAINT "QuarryWork_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuarryWork" ADD CONSTRAINT "QuarryWork_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuarryWork" ADD CONSTRAINT "QuarryWork_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "Deed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
