-- Выключение дела администратором (решение владельца 06.10): выключенное дело не попадает на новые дороги.
ALTER TABLE "Deed" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
