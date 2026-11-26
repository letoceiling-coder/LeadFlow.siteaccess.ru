-- CreateTable
CREATE TABLE "RadarConfig" (
    "tenantId" TEXT NOT NULL,
    "readsPerMinute" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarConfig_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "RadarProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'own',
    "target" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minusWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pollMinutes" INTEGER NOT NULL DEFAULT 15,
    "minScore" INTEGER NOT NULL DEFAULT 40,
    "botTokenEnc" TEXT,
    "botUsername" TEXT,
    "botChatId" TEXT,
    "botChatTitle" TEXT,
    "bindCodeHash" TEXT,
    "bindExpiresAt" TIMESTAMP(3),
    "hookSecretHash" TEXT,
    "lastPollAt" TIMESTAMP(3),
    "lastReportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "members" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cursor" INTEGER,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "chatUsername" TEXT NOT NULL,
    "chatTitle" TEXT NOT NULL,
    "authorUsername" TEXT,
    "authorName" TEXT,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "intent" TEXT NOT NULL DEFAULT 'other',
    "city" TEXT,
    "district" TEXT,
    "deadline" TEXT,
    "budget" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "reply" TEXT,
    "matched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'new',
    "snoozeUntil" TIMESTAMP(3),
    "organizationId" TEXT,
    "botMessageId" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "findingId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'not_relevant',
    "text" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarProject_tenantId_active_idx" ON "RadarProject"("tenantId", "active");

-- CreateIndex
CREATE INDEX "RadarSource_tenantId_idx" ON "RadarSource"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RadarSource_projectId_username_key" ON "RadarSource"("projectId", "username");

-- CreateIndex
CREATE INDEX "RadarFinding_tenantId_projectId_status_createdAt_idx" ON "RadarFinding"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RadarFinding_sourceId_messageId_key" ON "RadarFinding"("sourceId", "messageId");

-- CreateIndex
CREATE INDEX "RadarFeedback_projectId_createdAt_idx" ON "RadarFeedback"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "RadarSource" ADD CONSTRAINT "RadarSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RadarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarFinding" ADD CONSTRAINT "RadarFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RadarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarFinding" ADD CONSTRAINT "RadarFinding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RadarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarFeedback" ADD CONSTRAINT "RadarFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RadarProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

