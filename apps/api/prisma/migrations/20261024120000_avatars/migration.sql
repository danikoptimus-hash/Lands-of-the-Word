-- Аватарки участников и команд (решение владельца 24.10): сжатая картинка в базе, проверенная на уместность.
CREATE TABLE "Avatar" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/webp',
    "uploadedById" TEXT,
    "moderation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "avatarId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Team" ADD COLUMN "avatarId" TEXT;

CREATE UNIQUE INDEX "User_avatarId_key" ON "User"("avatarId");
CREATE UNIQUE INDEX "Team_avatarId_key" ON "Team"("avatarId");

ALTER TABLE "User" ADD CONSTRAINT "User_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
