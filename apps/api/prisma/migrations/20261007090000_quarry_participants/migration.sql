-- Общие дела Каменоломни (решение владельца 07.10): кто был — отмечают при сдаче, им дело зачитывается; доля состава у дела.
ALTER TABLE "QuarryWork" ADD COLUMN "participants" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Deed" ADD COLUMN "quorumPct" INTEGER;
