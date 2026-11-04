-- Разбитые бурей корабли с грузом (решение владельца 04.11): срочное задание, корабль на карте, сдачи команд, блоки стен из груза.
ALTER TABLE "Deed" ADD COLUMN "wreck" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "cargoBlocks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WallBlock" ADD COLUMN "cargo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Wreck" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "deedId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "model" INTEGER NOT NULL DEFAULT 0,
    "seed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "sunk" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Wreck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Wreck_gameId_closedAt_idx" ON "Wreck"("gameId", "closedAt");
ALTER TABLE "Wreck" ADD CONSTRAINT "Wreck_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wreck" ADD CONSTRAINT "Wreck_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "Deed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WreckWork" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "wreckId" TEXT NOT NULL,
    "deedId" TEXT,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "adminComment" TEXT NOT NULL DEFAULT '',
    "cargo" TEXT,
    "amount" INTEGER,
    CONSTRAINT "WreckWork_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WreckWork_gameId_status_idx" ON "WreckWork"("gameId", "status");
CREATE INDEX "WreckWork_wreckId_teamId_idx" ON "WreckWork"("wreckId", "teamId");
ALTER TABLE "WreckWork" ADD CONSTRAINT "WreckWork_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WreckWork" ADD CONSTRAINT "WreckWork_wreckId_fkey" FOREIGN KEY ("wreckId") REFERENCES "Wreck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WreckWork" ADD CONSTRAINT "WreckWork_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "Deed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WreckWork" ADD CONSTRAINT "WreckWork_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
