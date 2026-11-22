-- AlterTable
ALTER TABLE "Outreach" ADD COLUMN     "sheetSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "outreachId" TEXT,
    "scenarioId" TEXT,
    "title" TEXT NOT NULL,
    "product" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'brief',
    "amount" INTEGER,
    "deadlineAt" TIMESTAMP(3),
    "contactName" TEXT,
    "contactValue" TEXT,
    "notes" TEXT,
    "checklist" JSONB NOT NULL,
    "data" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "sheetSyncedAt" TIMESTAMP(3),
    "webhookAt" TIMESTAMP(3),
    "webhookError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_outreachId_key" ON "Project"("outreachId");

-- CreateIndex
CREATE INDEX "Project_tenantId_stage_updatedAt_idx" ON "Project"("tenantId", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_tenantId_createdAt_idx" ON "Project"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

