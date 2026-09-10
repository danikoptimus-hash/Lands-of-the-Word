-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "finishReason" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "winnerTeamId" TEXT;

