-- CreateTable
CREATE TABLE "TeamTaskLock" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "taskIndex" INTEGER NOT NULL,
    "wrong" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "dispute" TEXT,
    "disputedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "unlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTaskLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamTaskLock_gameId_disputedAt_idx" ON "TeamTaskLock"("gameId", "disputedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamTaskLock_teamId_nodeKey_taskIndex_key" ON "TeamTaskLock"("teamId", "nodeKey", "taskIndex");

-- AddForeignKey
ALTER TABLE "TeamTaskLock" ADD CONSTRAINT "TeamTaskLock_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

