-- Нарушение мира вызовом, защита ×2 при двух командах, защитный союз при трёх и более (решение владельца 22.10).
ALTER TABLE "Peace" ADD COLUMN "violated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Battle" ADD COLUMN "violation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Battle" ADD COLUMN "defenseFactor" INTEGER NOT NULL DEFAULT 1;
CREATE TYPE "AllianceStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'DECLINED');
CREATE TABLE "DefenseAlliance" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "victimId" TEXT NOT NULL,
    "allyId" TEXT NOT NULL,
    "status" "AllianceStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "DefenseAlliance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DefenseAlliance_battleId_allyId_key" ON "DefenseAlliance"("battleId", "allyId");
CREATE INDEX "DefenseAlliance_gameId_allyId_status_idx" ON "DefenseAlliance"("gameId", "allyId", "status");
ALTER TABLE "DefenseAlliance" ADD CONSTRAINT "DefenseAlliance_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
