-- Тайное дело: ссылки и описание сдачи видит только проверяющий администратор.
ALTER TABLE "Deed" ADD COLUMN "secret" BOOLEAN NOT NULL DEFAULT false;
