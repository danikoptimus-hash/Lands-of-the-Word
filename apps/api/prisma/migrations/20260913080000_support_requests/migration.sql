-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'CLOSED');

-- DropIndex
DROP INDEX "TeamTaskLock_gameId_disputedAt_idx";

-- AlterTable
ALTER TABLE "TeamTaskLock" DROP COLUMN "dispute",
DROP COLUMN "disputedAt",
DROP COLUMN "resolution",
DROP COLUMN "resolvedAt";

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT,
    "userId" TEXT NOT NULL,
    "nodeKey" TEXT,
    "bookCode" TEXT,
    "taskIndex" INTEGER,
    "message" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "unlocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportRequest_teamId_nodeKey_idx" ON "SupportRequest"("teamId", "nodeKey");

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

