-- Заморозка взятия дел участнику администратором (решение владельца 21.10).
ALTER TABLE "Membership" ADD COLUMN "deedsFrozenUntil" TIMESTAMP(3);
