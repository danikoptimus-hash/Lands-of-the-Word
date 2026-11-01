-- Городская стена (решение владельца 01.11): блоки стихов книги города, сданные хранителями в мирное время.
CREATE TABLE "WallBlock" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "bookCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startIdx" INTEGER NOT NULL,
    "endIdx" INTEGER NOT NULL,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "status" "EntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "adminComment" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "WallBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WallBlock_gameId_nodeKey_status_idx" ON "WallBlock"("gameId", "nodeKey", "status");
CREATE INDEX "WallBlock_teamId_nodeKey_idx" ON "WallBlock"("teamId", "nodeKey");
CREATE INDEX "WallBlock_userId_idx" ON "WallBlock"("userId");

ALTER TABLE "WallBlock" ADD CONSTRAINT "WallBlock_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WallBlock" ADD CONSTRAINT "WallBlock_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
