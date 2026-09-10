-- CreateEnum
CREATE TYPE "PassageStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "MapNode" ADD COLUMN     "ruined" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "capitalMovedAt" TIMESTAMP(3),
ADD COLUMN     "lastHintAt" TIMESTAMP(3),
ADD COLUMN     "lastPeekAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TeamCityState" ADD COLUMN     "hintTasks" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "TeamEdgeTask" ADD COLUMN     "donation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "donationAmount" INTEGER;

-- CreateTable
CREATE TABLE "PassageRequest" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "answer" TEXT NOT NULL DEFAULT '',
    "status" "PassageStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PassageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPeek" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PassageRequest_gameId_nodeKey_idx" ON "PassageRequest"("gameId", "nodeKey");

-- CreateIndex
CREATE INDEX "PassageRequest_requesterId_idx" ON "PassageRequest"("requesterId");

-- CreateIndex
CREATE INDEX "PassageRequest_ownerId_idx" ON "PassageRequest"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPeek_teamId_nodeKey_key" ON "TeamPeek"("teamId", "nodeKey");

-- AddForeignKey
ALTER TABLE "PassageRequest" ADD CONSTRAINT "PassageRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassageRequest" ADD CONSTRAINT "PassageRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPeek" ADD CONSTRAINT "TeamPeek_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

