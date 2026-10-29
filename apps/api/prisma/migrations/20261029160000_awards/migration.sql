-- Награды (решение владельца 29.10): командные и личные значки, посчитанные по истории игры.
CREATE TABLE "AwardGrant" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'once',
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwardGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AwardGrant_gameId_teamId_userId_code_key_key" ON "AwardGrant"("gameId", "teamId", "userId", "code", "key");
CREATE INDEX "AwardGrant_gameId_teamId_idx" ON "AwardGrant"("gameId", "teamId");
CREATE INDEX "AwardGrant_gameId_userId_idx" ON "AwardGrant"("gameId", "userId");
