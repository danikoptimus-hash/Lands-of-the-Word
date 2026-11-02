-- План заучивания: кто из команды учит стих (решение владельца 02.11).
CREATE TABLE "LearnPlan" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "bookCode" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LearnPlan_teamId_bookCode_idx_userId_key" ON "LearnPlan"("teamId", "bookCode", "idx", "userId");
CREATE INDEX "LearnPlan_teamId_bookCode_idx" ON "LearnPlan"("teamId", "bookCode");
ALTER TABLE "LearnPlan" ADD CONSTRAINT "LearnPlan_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnPlan" ADD CONSTRAINT "LearnPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
