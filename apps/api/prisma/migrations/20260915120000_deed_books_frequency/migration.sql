-- Дело: несколько книг по теме вместо одной, частота появления (1 редко, 2 обычно, 3 часто).
ALTER TABLE "Deed" ADD COLUMN "bookCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Deed" ADD COLUMN "frequency" INTEGER NOT NULL DEFAULT 2;
UPDATE "Deed" SET "bookCodes" = ARRAY["bookCode"] WHERE "bookCode" IS NOT NULL;
ALTER TABLE "Deed" DROP COLUMN "bookCode";
