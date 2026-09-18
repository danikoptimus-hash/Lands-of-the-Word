-- Этап 4 решений владельца 18.09: журнал событий (лента, новости, летопись, «Моё служение», «Книга сезона»), мир между командами, руины с сокровищем.
ALTER TABLE "MapNode" ADD COLUMN "treasureTeamId" TEXT;

CREATE TYPE "PeaceStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'DECLINED', 'ENDED');

CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "everyone" BOOLEAN NOT NULL DEFAULT false,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Journal_gameId_createdAt_idx" ON "Journal"("gameId", "createdAt");
CREATE INDEX "Journal_teamId_createdAt_idx" ON "Journal"("teamId", "createdAt");
CREATE INDEX "Journal_userId_idx" ON "Journal"("userId");
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Peace" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "status" "PeaceStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    CONSTRAINT "Peace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Peace_gameId_status_idx" ON "Peace"("gameId", "status");
ALTER TABLE "Peace" ADD CONSTRAINT "Peace_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Peace" ADD CONSTRAINT "Peace_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Peace" ADD CONSTRAINT "Peace_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
