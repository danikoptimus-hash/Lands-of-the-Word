-- Моря Библии на карте (решение владельца 06.10): вода внутренних морей на гексах, берег на узлах, вахты и переправа у команд.
ALTER TABLE "MapHex" ADD COLUMN "sea" TEXT;
ALTER TABLE "MapNode" ADD COLUMN "sea" TEXT;
CREATE TABLE "TeamSeaState" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "seaCode" TEXT NOT NULL,
  "doneTasks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "taskDrafts" JSONB,
  "openedAt" TIMESTAMP(3),
  "crossedAt" TIMESTAMP(3),
  "crossFrom" TEXT,
  "crossTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamSeaState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamSeaState_teamId_seaCode_key" ON "TeamSeaState"("teamId", "seaCode");
CREATE INDEX "TeamSeaState_gameId_seaCode_idx" ON "TeamSeaState"("gameId", "seaCode");
ALTER TABLE "TeamSeaState" ADD CONSTRAINT "TeamSeaState_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
