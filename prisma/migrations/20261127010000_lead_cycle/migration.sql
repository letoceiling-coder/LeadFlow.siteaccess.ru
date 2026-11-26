-- S1 «Цикл лида» (бриф 27.11): только добавление — новые nullable-поля и три новые таблицы.
ALTER TABLE "Outreach" ADD COLUMN "preset" TEXT;
ALTER TABLE "Outreach" ADD COLUMN "grade" TEXT;
ALTER TABLE "Outreach" ADD COLUMN "dossier" JSONB;
ALTER TABLE "Outreach" ADD COLUMN "drafts" JSONB;
ALTER TABLE "Outreach" ADD COLUMN "variant" TEXT;

CREATE TABLE "Touch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "variant" TEXT,
    "text" TEXT NOT NULL,
    "actorId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Touch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Touch_tenantId_sentAt_idx" ON "Touch"("tenantId", "sentAt");
CREATE INDEX "Touch_outreachId_sentAt_idx" ON "Touch"("outreachId", "sentAt");
ALTER TABLE "Touch" ADD CONSTRAINT "Touch_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeadReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'rules',
    "next" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadReply_tenantId_createdAt_idx" ON "LeadReply"("tenantId", "createdAt");
CREATE INDEX "LeadReply_outreachId_createdAt_idx" ON "LeadReply"("outreachId", "createdAt");
ALTER TABLE "LeadReply" ADD CONSTRAINT "LeadReply_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadTask_tenantId_status_dueAt_idx" ON "LeadTask"("tenantId", "status", "dueAt");
CREATE INDEX "LeadTask_outreachId_idx" ON "LeadTask"("outreachId");
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
