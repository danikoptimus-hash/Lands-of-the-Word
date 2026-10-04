-- Разовая перекомпоновка свободных дел при запуске сервера (решение владельца 04.10): отметка, что для игры уже сделано.
ALTER TABLE "Game" ADD COLUMN "deedsReshuffledAt" TIMESTAMP(3);
