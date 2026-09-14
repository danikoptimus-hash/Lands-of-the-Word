-- AlterTable
ALTER TABLE "MapHex" ADD COLUMN     "island" TEXT NOT NULL DEFAULT 'OT';

-- AlterTable
ALTER TABLE "MapNode" ADD COLUMN     "coastal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "island" TEXT NOT NULL DEFAULT 'OT';

-- AlterTable
ALTER TABLE "TeamEdgeTask" ADD COLUMN     "sea" BOOLEAN NOT NULL DEFAULT false;

