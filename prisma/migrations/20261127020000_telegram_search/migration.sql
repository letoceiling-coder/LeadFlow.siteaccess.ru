-- S2: поиск Telegram-каналов организаций. Только добавление новой таблицы.
CREATE TABLE "TelegramSearch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT,
    "niche" TEXT NOT NULL,
    "city" TEXT,
    "limit" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" JSONB,
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "merged" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "reads" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramSearch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelegramSearch_tenantId_createdAt_idx" ON "TelegramSearch"("tenantId", "createdAt");
