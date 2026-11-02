-- Стена ложится в ответ за минуту до конца времени ответа, а не при «Испытать» (решение владельца 02.11).
ALTER TABLE "Battle" ADD COLUMN "wallAppliedAt" TIMESTAMP(3);
