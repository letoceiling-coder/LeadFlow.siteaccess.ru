-- S4: очередь поисков. Сбор отдаётся парсеру по одному; dispatchedAt — когда LeadFlow отдал его парсеру.
-- Только добавление: пустое поле у старых сборов значит «уже отдан» (если есть externalId) или «ждёт».
ALTER TABLE "ParserTask" ADD COLUMN "dispatchedAt" TIMESTAMP(3);
CREATE INDEX "ParserTask_tenantId_type_status_idx" ON "ParserTask"("tenantId", "type", "status");
