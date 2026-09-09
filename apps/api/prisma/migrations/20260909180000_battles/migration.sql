-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('QUEUED', 'ATTACK', 'DEFENSE', 'WON', 'REPELLED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BattleSide" AS ENUM ('ATTACK', 'DEFENSE');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "MapNode" ADD COLUMN     "defenseLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedForever" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sumMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TeamCityState" ADD COLUMN     "attackPenalty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "secondCapital" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Battle" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "bookCode" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "status" "BattleStatus" NOT NULL DEFAULT 'QUEUED',
    "sumMode" BOOLEAN NOT NULL DEFAULT false,
    "bid" INTEGER NOT NULL,
    "defenseBid" INTEGER,
    "passageStart" INTEGER,
    "passageEnd" INTEGER,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "attackDeadline" TIMESTAMP(3),
    "attackDoneAt" TIMESTAMP(3),
    "attackApprovedAt" TIMESTAMP(3),
    "defenseDeadline" TIMESTAMP(3),
    "defenseDoneAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleEntry" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "side" "BattleSide" NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startIdx" INTEGER NOT NULL,
    "endIdx" INTEGER NOT NULL,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "status" "EntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "adminComment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "BattleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Battle_gameId_nodeKey_status_idx" ON "Battle"("gameId", "nodeKey", "status");

-- CreateIndex
CREATE INDEX "Battle_gameId_status_idx" ON "Battle"("gameId", "status");

-- CreateIndex
CREATE INDEX "BattleEntry_battleId_side_idx" ON "BattleEntry"("battleId", "side");

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleEntry" ADD CONSTRAINT "BattleEntry_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

