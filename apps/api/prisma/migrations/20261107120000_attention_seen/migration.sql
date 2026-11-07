-- Прочитанные пункты «Внимание» (решение владельца 07.11): у каждого участника свои.
CREATE TABLE "AttentionSeen" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttentionSeen_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttentionSeen_userId_kind_refId_key" ON "AttentionSeen"("userId", "kind", "refId");
CREATE INDEX "AttentionSeen_gameId_userId_idx" ON "AttentionSeen"("gameId", "userId");
ALTER TABLE "AttentionSeen" ADD CONSTRAINT "AttentionSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttentionSeen" ADD CONSTRAINT "AttentionSeen_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
