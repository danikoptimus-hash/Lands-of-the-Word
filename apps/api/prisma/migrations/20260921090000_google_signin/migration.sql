-- Вход через Google: идентификатор Google (sub) у учётки. Имя и фото из Google не хранятся.
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
