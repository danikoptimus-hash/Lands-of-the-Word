-- Обмен городами между послами (решение владельца 04.10).
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'COUNTERED', 'DONE', 'CANCELLED');
CREATE TABLE "CityTrade" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "fromId" TEXT NOT NULL,
  "toId" TEXT NOT NULL,
  "offerKey" TEXT NOT NULL,
  "counterKey" TEXT,
  "declinedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "message" TEXT NOT NULL DEFAULT '',
  "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  CONSTRAINT "CityTrade_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CityTrade_gameId_status_idx" ON "CityTrade"("gameId", "status");
CREATE INDEX "CityTrade_fromId_idx" ON "CityTrade"("fromId");
CREATE INDEX "CityTrade_toId_idx" ON "CityTrade"("toId");
ALTER TABLE "CityTrade" ADD CONSTRAINT "CityTrade_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityTrade" ADD CONSTRAINT "CityTrade_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityTrade" ADD CONSTRAINT "CityTrade_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
