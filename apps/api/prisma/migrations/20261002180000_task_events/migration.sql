-- События в заданиях города для раздела «Поведение» (решение владельца 02.10).
CREATE TABLE "TaskEvent" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nodeKey" TEXT NOT NULL,
  "taskIndex" INTEGER,
  "kind" TEXT NOT NULL,
  "awayMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskEvent_gameId_userId_idx" ON "TaskEvent"("gameId", "userId");
CREATE INDEX "TaskEvent_gameId_createdAt_idx" ON "TaskEvent"("gameId", "createdAt");
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
