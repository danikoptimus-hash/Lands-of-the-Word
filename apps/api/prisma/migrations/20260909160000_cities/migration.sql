-- AlterTable
ALTER TABLE "MapNode" ADD COLUMN     "cityKey" TEXT;

-- CreateTable
CREATE TABLE "TeamCityState" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "orderSolved" BOOLEAN NOT NULL DEFAULT false,
    "orderAttempts" INTEGER NOT NULL DEFAULT 0,
    "doneTasks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "answerAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastWrongAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "isCapital" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamCityState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamCityState_gameId_nodeKey_idx" ON "TeamCityState"("gameId", "nodeKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCityState_teamId_nodeKey_key" ON "TeamCityState"("teamId", "nodeKey");

-- AddForeignKey
ALTER TABLE "TeamCityState" ADD CONSTRAINT "TeamCityState_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

