-- Метки команды на карте: гекс и короткая подпись, видны всей команде.
CREATE TABLE "TeamMark" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamMark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamMark_teamId_q_r_key" ON "TeamMark"("teamId", "q", "r");
CREATE INDEX "TeamMark_gameId_teamId_idx" ON "TeamMark"("gameId", "teamId");
ALTER TABLE "TeamMark" ADD CONSTRAINT "TeamMark_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
