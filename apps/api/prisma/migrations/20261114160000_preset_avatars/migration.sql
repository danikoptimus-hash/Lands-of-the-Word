-- Готовые аватарки и гербы вместо своих фото (решение владельца 14.11: «убрать аватарки вообще, убрать валидатор
-- аватарок, хранение и всё, что с ними связано»). Загруженные фото удаляются вместе с таблицей; в "avatarId"
-- участника и команды теперь лежит код готовой картинки («a017», «g05»), а не ссылка на запись.
ALTER TABLE "User" DROP CONSTRAINT "User_avatarId_fkey";
ALTER TABLE "Team" DROP CONSTRAINT "Team_avatarId_fkey";
DROP INDEX "User_avatarId_key";
DROP INDEX "Team_avatarId_key";
UPDATE "User" SET "avatarId" = NULL WHERE "avatarId" IS NOT NULL;
UPDATE "Team" SET "avatarId" = NULL WHERE "avatarId" IS NOT NULL;
ALTER TABLE "User" DROP COLUMN "avatarBlocked";
DROP TABLE "Avatar";
