-- Дни активности пользователей для аналитики (решение владельца 23.10).
CREATE TABLE "UserDay" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    CONSTRAINT "UserDay_pkey" PRIMARY KEY ("userId", "day")
);
CREATE INDEX "UserDay_day_idx" ON "UserDay"("day");
ALTER TABLE "UserDay" ADD CONSTRAINT "UserDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
