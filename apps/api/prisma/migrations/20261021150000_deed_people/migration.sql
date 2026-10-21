-- Список людей у дела — кому звонить (решение владельца 21.10): имена подставляются на стороны равномерно.
CREATE TABLE "DeedPerson" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "deedId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeedPerson_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeedPerson_gameId_deedId_idx" ON "DeedPerson"("gameId", "deedId");
ALTER TABLE "DeedPerson" ADD CONSTRAINT "DeedPerson_deedId_fkey" FOREIGN KEY ("deedId") REFERENCES "Deed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamEdgeTask" ADD COLUMN "personId" TEXT;
ALTER TABLE "TeamEdgeTask" ADD CONSTRAINT "TeamEdgeTask_personId_fkey" FOREIGN KEY ("personId") REFERENCES "DeedPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
