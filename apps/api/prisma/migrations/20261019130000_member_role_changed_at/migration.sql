-- Лимит смены роли — на каждого участника, а не на команду (решение владельца 19.10).
ALTER TABLE "Membership" ADD COLUMN "roleChangedAt" TIMESTAMP(3);
