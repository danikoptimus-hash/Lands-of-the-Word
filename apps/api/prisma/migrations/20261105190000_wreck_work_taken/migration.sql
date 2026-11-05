-- Взять срочное задание с разбитого корабля (решение владельца 05.11): статус TAKEN и время взятия у WreckWork.
ALTER TABLE "WreckWork" ADD COLUMN "takenAt" TIMESTAMP(3);
