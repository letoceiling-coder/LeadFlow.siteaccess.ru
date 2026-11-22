CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "segment" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'D',
    "factors" JSONB,
    "card" JSONB,
    "cardStatus" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "rejectReason" TEXT,
    "snoozeUntil" TIMESTAMP(3),
    "pitch" TEXT,
    "channel" TEXT,
    "sentAt" TIMESTAMP(3),
    "followUpStep" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Outreach_organizationId_key" ON "Outreach"("organizationId");
CREATE INDEX "Outreach_tenantId_status_priority_score_idx" ON "Outreach"("tenantId", "status", "priority", "score");
CREATE INDEX "Outreach_tenantId_nextFollowUpAt_idx" ON "Outreach"("tenantId", "nextFollowUpAt");
CREATE INDEX "Outreach_tenantId_sentAt_idx" ON "Outreach"("tenantId", "sentAt");

ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
