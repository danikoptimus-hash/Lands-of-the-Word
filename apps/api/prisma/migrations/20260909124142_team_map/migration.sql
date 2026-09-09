-- CreateEnum
CREATE TYPE "EdgeTaskStatus" AS ENUM ('OPEN', 'TAKEN', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TeamNodeState" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamNodeState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamEdgeTask" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "deedId" TEXT NOT NULL,
    "status" "EdgeTaskStatus" NOT NULL DEFAULT 'OPEN',
    "takenById" TEXT,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "adminComment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEdgeTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamNodeState_teamId_nodeKey_key" ON "TeamNodeState"("teamId", "nodeKey");

-- CreateIndex
CREATE INDEX "TeamEdgeTask_gameId_status_idx" ON "TeamEdgeTask"("gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEdgeTask_teamId_fromKey_toKey_key" ON "TeamEdgeTask"("teamId", "fromKey", "toKey");

-- AddForeignKey
ALTER TABLE "TeamNodeState" ADD CONSTRAINT "TeamNodeState_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEdgeTask" ADD CONSTRAINT "TeamEdgeTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEdgeTask" ADD CONSTRAINT "TeamEdgeTask_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "Deed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
