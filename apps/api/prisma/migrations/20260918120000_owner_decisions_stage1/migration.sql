-- Решения владельца 18.09 (этап 1): закрепление на срок, стоп-часы, очередь после сгорания, зачёт выученных стихов,
-- заместитель капитана и кормчий, роли с одобрением администратора, растущая пауза ключа, возврат дел, штрафы.
ALTER TYPE "TeamRole" ADD VALUE 'DEPUTY';
ALTER TYPE "GameRole" ADD VALUE 'HELMSMAN';

ALTER TABLE "MapNode" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "MapNode" ADD COLUMN "fatigueAt" TIMESTAMP(3);
UPDATE "MapNode" SET "lockedUntil" = NOW() + INTERVAL '21 days' WHERE "lockedForever" = true;
ALTER TABLE "MapNode" DROP COLUMN "lockedForever";

ALTER TABLE "Team" ADD COLUMN "lastRoleChangeAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "pendingRole" "GameRole";
ALTER TABLE "TeamEdgeTask" ADD COLUMN "takenAt" TIMESTAMP(3);
UPDATE "TeamEdgeTask" SET "takenAt" = NOW() WHERE "status" = 'TAKEN';
ALTER TABLE "TeamCityState" ADD COLUMN "keyWrong" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TeamCityState" ADD COLUMN "keyLockedUntil" TIMESTAMP(3);
ALTER TABLE "Battle" ADD COLUMN "attackPausedMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Battle" ADD COLUMN "afterBurn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BattleEntry" ADD COLUMN "carried" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TeamPenalty" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "fromKey" TEXT NOT NULL,
  "toKey" TEXT NOT NULL,
  "byId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamPenalty_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamPenalty_gameId_teamId_idx" ON "TeamPenalty"("gameId", "teamId");
ALTER TABLE "TeamPenalty" ADD CONSTRAINT "TeamPenalty_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
