-- CreateEnum
CREATE TYPE "ProofType" AS ENUM ('REPORT', 'PHOTO_LINK', 'VIDEO_LINK', 'CONFIRMATION');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Deed" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "proofType" "ProofType" NOT NULL DEFAULT 'PHOTO_LINK',
    "canRepeat" BOOLEAN NOT NULL DEFAULT false,
    "bookCode" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deed_gameId_idx" ON "Deed"("gameId");

-- AddForeignKey
ALTER TABLE "Deed" ADD CONSTRAINT "Deed_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
