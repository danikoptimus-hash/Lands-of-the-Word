-- Нажатия кнопок карты (вопрос владельца 24.10: «есть гипотеза, что ими никто не пользуется»): что нажали, где, с какого
-- устройства и когда. Без пользователя.
CREATE TABLE "UiAction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "device" TEXT NOT NULL,

    CONSTRAINT "UiAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UiAction_createdAt_idx" ON "UiAction"("createdAt");
CREATE INDEX "UiAction_action_createdAt_idx" ON "UiAction"("action", "createdAt");
