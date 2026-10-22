-- Мир на срок (решение владельца 22.10): дни и дата окончания; старые миры без срока остаются расторжимыми.
ALTER TABLE "Peace" ADD COLUMN "days" INTEGER;
ALTER TABLE "Peace" ADD COLUMN "until" TIMESTAMP(3);
