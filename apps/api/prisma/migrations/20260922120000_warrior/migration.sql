-- Роль «Воин»: стихи в испытаниях считаются вдвое (вес хранится на отметке).
ALTER TYPE "GameRole" ADD VALUE 'WARRIOR';
ALTER TABLE "BattleEntry" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 1;
