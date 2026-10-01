-- Черновики расстановки районов и заданий «по порядку»: общие для команды, переживают закрытие приложения.
ALTER TABLE "TeamCityState" ADD COLUMN "orderDraft" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "taskDrafts" JSONB;
