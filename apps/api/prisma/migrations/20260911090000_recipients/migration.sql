-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('FAMILY', 'WIDOW', 'ELDER', 'OTHER');

-- AlterTable
ALTER TABLE "MapNode" ADD COLUMN     "recipientId" TEXT;

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "RecipientKind" NOT NULL DEFAULT 'FAMILY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recipient_gameId_idx" ON "Recipient"("gameId");

-- AddForeignKey
ALTER TABLE "MapNode" ADD CONSTRAINT "MapNode_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

