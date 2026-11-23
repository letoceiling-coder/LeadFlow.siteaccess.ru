-- Скан сайта лида и коммерческое предложение после ответа
ALTER TABLE "Organization" ADD COLUMN "siteScan" JSONB;
ALTER TABLE "Outreach" ADD COLUMN "proposal" JSONB;
ALTER TABLE "Outreach" ADD COLUMN "proposalToken" TEXT;
ALTER TABLE "Outreach" ADD COLUMN "proposalAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Outreach_proposalToken_key" ON "Outreach"("proposalToken");
