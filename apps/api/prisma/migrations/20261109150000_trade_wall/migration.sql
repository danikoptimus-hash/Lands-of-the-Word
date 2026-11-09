-- Стена при обмене городов (решение владельца 09.11): посол отмечает, переходит ли стена вместе с городом или сгорает.
ALTER TABLE "CityTrade" ADD COLUMN "offerWall" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CityTrade" ADD COLUMN "counterWall" BOOLEAN NOT NULL DEFAULT false;
-- Команда, которой блок перешёл вместе с городом; пусто — блок держит построившая команда.
ALTER TABLE "WallBlock" ADD COLUMN "holderId" TEXT;
ALTER TABLE "WallBlock" ADD CONSTRAINT "WallBlock_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WallBlock_holderId_nodeKey_idx" ON "WallBlock"("holderId", "nodeKey");
