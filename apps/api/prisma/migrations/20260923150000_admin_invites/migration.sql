-- Приглашение администратора: ссылка без команды.
ALTER TABLE "Invite" ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE "Invite" ADD COLUMN "admin" BOOLEAN NOT NULL DEFAULT false;
