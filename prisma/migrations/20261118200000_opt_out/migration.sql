CREATE TABLE "OptOut" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'link',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptOut_organizationId_key" ON "OptOut"("organizationId");
CREATE INDEX "OptOut_tenantId_createdAt_idx" ON "OptOut"("tenantId", "createdAt");

ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
