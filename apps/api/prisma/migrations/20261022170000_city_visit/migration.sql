-- Отчёт о визите к адресату конверта (решение владельца 22.10): сдаётся в тот же день, иначе город свободен.
CREATE TYPE "VisitStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TABLE "CityVisit" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "bookCode" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "members" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT NOT NULL DEFAULT '',
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminComment" TEXT NOT NULL DEFAULT '',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CityVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CityVisit_gameId_status_idx" ON "CityVisit"("gameId", "status");
CREATE INDEX "CityVisit_teamId_nodeKey_status_idx" ON "CityVisit"("teamId", "nodeKey", "status");
ALTER TABLE "CityVisit" ADD CONSTRAINT "CityVisit_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityVisit" ADD CONSTRAINT "CityVisit_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
