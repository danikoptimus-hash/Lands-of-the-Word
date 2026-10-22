-- Разведка и подсказка пророка — раз в неделю на каждого участника с ролью, а не на команду (решение владельца 22.10).
ALTER TABLE "Membership" ADD COLUMN "peekedAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "hintedAt" TIMESTAMP(3);
