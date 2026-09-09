-- AlterTable
ALTER TABLE "MapNode" DROP COLUMN "rotation",
DROP COLUMN "terrain",
ADD COLUMN     "corner" TEXT NOT NULL DEFAULT 'N';

-- CreateTable
CREATE TABLE "MapHex" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "terrain" TEXT NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MapHex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapHex_gameId_q_r_key" ON "MapHex"("gameId", "q", "r");

-- AddForeignKey
ALTER TABLE "MapHex" ADD CONSTRAINT "MapHex_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Модель карты изменилась (ходим по сторонам гексов): старые карты и прогресс несовместимы.
-- Сбрасываем карты и возвращаем игры в черновик; команды, участники и дела сохраняются.
DELETE FROM "TeamEdgeTask";
DELETE FROM "TeamNodeState";
DELETE FROM "MapEdge";
DELETE FROM "MapNode";
UPDATE "Team" SET "startNodeKey" = NULL;
UPDATE "Game" SET "status" = 'DRAFT', "mapSeed" = NULL, "startedAt" = NULL WHERE "status" = 'ACTIVE';
