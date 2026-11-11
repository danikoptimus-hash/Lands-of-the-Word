-- Метка команды «убрать, когда здесь откроются облака» (решение владельца 11.11).
ALTER TABLE "TeamMark" ADD COLUMN "dropOnReveal" BOOLEAN NOT NULL DEFAULT false;
