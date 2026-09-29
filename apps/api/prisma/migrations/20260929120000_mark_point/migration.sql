-- Метки команды: точное место нажатия (дробные осевые координаты); на одном гексе может быть несколько меток.
ALTER TABLE "TeamMark" ADD COLUMN "qf" DOUBLE PRECISION, ADD COLUMN "rf" DOUBLE PRECISION;
UPDATE "TeamMark" SET "qf" = "q", "rf" = "r";
ALTER TABLE "TeamMark" ALTER COLUMN "qf" SET NOT NULL, ALTER COLUMN "rf" SET NOT NULL;
DROP INDEX "TeamMark_teamId_q_r_key";
