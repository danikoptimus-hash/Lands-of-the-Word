-- CreateTable
CREATE TABLE "UiMetric" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "page" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "dpr" DOUBLE PRECISION NOT NULL,
    "viewW" INTEGER NOT NULL,
    "viewH" INTEGER NOT NULL,
    "ttfb" INTEGER,
    "fcp" INTEGER,
    "lcp" INTEGER,
    "load" INTEGER,
    "fps" DOUBLE PRECISION,
    "jank" DOUBLE PRECISION,
    "longTasks" INTEGER,
    "memoryMb" INTEGER,

    CONSTRAINT "UiMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UiMetric_createdAt_idx" ON "UiMetric"("createdAt");

