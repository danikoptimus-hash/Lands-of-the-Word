-- Этап 2 решений владельца 18.09: дела издалека, баллы осады, участники дела группой, осада делами; «подтверждение» → отчёт.
ALTER TABLE "Deed" ADD COLUMN "remote" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deed" ADD COLUMN "siegePoints" INTEGER;
UPDATE "Deed" SET "proofType" = 'REPORT' WHERE "proofType" = 'CONFIRMATION';
ALTER TABLE "TeamEdgeTask" ADD COLUMN "participants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MapNode" ADD COLUMN "maxReachedAt" TIMESTAMP(3);
CREATE TYPE "SiegeStatus" AS ENUM ('ACTIVE', 'WON', 'REPELLED', 'CANCELLED');
CREATE TABLE "Siege" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "nodeKey" TEXT NOT NULL,
  "attackerId" TEXT NOT NULL,
  "defenderId" TEXT NOT NULL,
  "status" "SiegeStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "attackerPoints" INTEGER NOT NULL DEFAULT 0,
  "defenderPoints" INTEGER NOT NULL DEFAULT 0,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Siege_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Siege_gameId_nodeKey_status_idx" ON "Siege"("gameId", "nodeKey", "status");
