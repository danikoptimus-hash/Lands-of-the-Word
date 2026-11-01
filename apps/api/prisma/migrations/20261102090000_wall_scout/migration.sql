-- Разведка стен (решение владельца 02.11): отдельный недельный лимит разведчика и снимок «есть стена / нет» по чужим городам.
ALTER TABLE "Membership" ADD COLUMN "wallScoutedAt" TIMESTAMP(3);

CREATE TABLE "TeamWallScout" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "hasWall" BOOLEAN NOT NULL,
    "scoutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamWallScout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamWallScout_teamId_nodeKey_key" ON "TeamWallScout"("teamId", "nodeKey");

ALTER TABLE "TeamWallScout" ADD CONSTRAINT "TeamWallScout_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
