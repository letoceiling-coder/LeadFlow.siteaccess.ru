-- Регистрация по почте и Telegram, заявки на доступ, админка платформы
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "telegramId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "adminNote" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- Существующие пользователи заводились с паролем и настоящей почтой.
UPDATE "User" SET "emailVerified" = true;

-- Администратор платформы по умолчанию — владелец самого первого пространства.
UPDATE "User" SET "isPlatformAdmin" = true WHERE "id" = (
  SELECT m."userId" FROM "Membership" m JOIN "Tenant" t ON t."id" = m."tenantId"
  WHERE m."role" = 'OWNER' ORDER BY t."createdAt" ASC, m."createdAt" ASC LIMIT 1
);

ALTER TABLE "Invitation" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "Invitation" ADD COLUMN "note" TEXT;

CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "inviteToken" TEXT,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramName" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthCode_codeHash_key" ON "AuthCode"("codeHash");
CREATE INDEX "AuthCode_email_createdAt_idx" ON "AuthCode"("email", "createdAt");

CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "secretEnc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
