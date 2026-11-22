import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { ANALYSIS_PROMPT_VERSION, buildAnalysisPrompt, type BriefFacts } from "../domain/brief";
import { resolveTaskModel } from "../domain/models";
import { analysisResultSchema, completeJson } from "../integrations/openrouter";
import { requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { assertBudget, audit, getSettings, moveLead, notify, recordCost } from "./common";
import { scoreOrganization } from "./organizations";

export async function enqueueAnalysis(tenantId: string, userId: string, organizationIds: string[], confirmLarge = false) {
  const settings = await getSettings(tenantId);
  const estimate = settings.ai.maxCostPerAnalysisUsd * organizationIds.length;
  if (organizationIds.length > 10 && settings.confirm.expensiveAi && !confirmLarge) {
    throw new ApiError(409, "Пакетный AI-анализ нужно подтвердить: он может быть платным.", "confirm_required");
  }
  await assertBudget(tenantId, estimate);
  await requireReady(tenantId, "openrouter", "AI-анализ");
  const model = resolveTaskModel("analysis", settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL);
  const organizations = await prisma.organization.findMany({ where: { tenantId, id: { in: organizationIds } } });
  if (organizations.length !== organizationIds.length) throw new ApiError(404, "Часть организаций не найдена", "not_found");
  if (organizations.some((item) => item.isDemo)) {
    throw new ApiError(409, "Демонстрационные карточки не отправляются во внешний AI.", "demo_blocked");
  }
  const reports = [];
  for (const organization of organizations) {
    const report = await prisma.analysisReport.create({
      data: { tenantId, organizationId: organization.id, status: "queued", promptVersion: ANALYSIS_PROMPT_VERSION, model },
    });
    await enqueueJob({
      tenantId,
      type: "analysis.run",
      payload: { reportId: report.id },
      idempotencyKey: `analysis:${report.id}`,
    });
    reports.push(report);
  }
  await audit({ tenantId, actorId: userId, action: "analysis.enqueue", meta: { count: reports.length } });
  return reports;
}

function factsOf(organization: {
  name: string;
  category: string | null;
  city: string | null;
  region: string | null;
  address: string | null;
  website: string | null;
  websiteStatus: string;
  rating: number | null;
  reviewCount: number | null;
  services: string[];
  features: string[];
  hours: unknown;
  description: string | null;
  sourceUrl: string | null;
  contacts: { type: string; value: string }[];
  raw: unknown;
}): BriefFacts & { rawKnownKeys: string[] } {
  const raw = organization.raw && typeof organization.raw === "object" ? Object.keys(organization.raw as object) : [];
  return {
    name: organization.name,
    category: organization.category,
    city: organization.city,
    region: organization.region,
    address: organization.address,
    phones: organization.contacts.filter((contact) => contact.type === "phone").map((contact) => contact.value),
    emails: organization.contacts.filter((contact) => contact.type === "email").map((contact) => contact.value),
    socials: organization.contacts.filter((contact) => contact.type === "social").map((contact) => contact.value),
    website: organization.website,
    websiteStatus: organization.websiteStatus,
    rating: organization.rating,
    reviewCount: organization.reviewCount,
    services: organization.services,
    features: organization.features,
    hours: organization.hours,
    description: organization.description,
    sourceUrl: organization.sourceUrl,
    rawKnownKeys: raw,
  };
}

export async function runAnalysis(reportId: string) {
  const report = await prisma.analysisReport.findUnique({ where: { id: reportId }, include: { organization: { include: { contacts: true } } } });
  if (!report || report.status === "completed") return;
  const settings = await getSettings(report.tenantId);
  const integration = await requireReady(report.tenantId, "openrouter", "AI-анализ");
  const model = resolveTaskModel("analysis", report.model || settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL);
  await assertBudget(report.tenantId, settings.ai.maxCostPerAnalysisUsd);
  const prompt = buildAnalysisPrompt(factsOf(report.organization));
  try {
    const result = await completeJson({
      baseUrl: String(integration.config.baseUrl),
      apiKey: integration.secrets.apiKey, secrets: integration.secrets,
      model,
      system: prompt.system,
      user: prompt.user,
      schema: analysisResultSchema,
      maxTokens: 1800,
    });
    const knownServices = new Set(report.organization.services.map((item) => item.toLowerCase()));
    const services = knownServices.size
      ? result.data.services.filter((item: string) => knownServices.has(item.toLowerCase()))
      : [];
    const reportBody = { ...result.data, services, servicesDroppedAsUnconfirmed: result.data.services.filter((item: string) => !services.includes(item)) };
    const cost = typeof result.usage.cost === "number" ? result.usage.cost : null;
    await prisma.analysisReport.update({
      where: { id: report.id },
      data: {
        status: "completed",
        report: reportBody as Prisma.InputJsonValue,
        confidence: result.data.confidence,
        inputTokens: result.usage.prompt_tokens ?? null,
        outputTokens: result.usage.completion_tokens ?? null,
        costUsd: cost,
        costUnknown: cost == null,
        finishedAt: new Date(),
        model,
      },
    });
    await recordCost({ tenantId: report.tenantId, provider: "openrouter", operation: "analysis", amountUsd: cost, organizationId: report.organizationId, refType: "analysis", refId: report.id });
    await scoreOrganization(report.tenantId, report.organizationId, result.data.commercialPotential);
    await prisma.organization.update({ where: { id: report.organizationId }, data: { processingStatus: "analyzed" } });
    await moveLead(report.tenantId, report.organizationId, "analyzed");
    await notify(report.tenantId, "AI-анализ готов", report.organization.name, `/organizations/${report.organizationId}`);
    const { emitTrigger } = await import("./automations");
    await emitTrigger(report.tenantId, "analysis.completed", { organizationId: report.organizationId, score: report.organization.leadScore, websiteStatus: report.organization.websiteStatus });
  } catch (error) {
    await prisma.analysisReport.update({
      where: { id: report.id },
      data: { status: "failed", error: error instanceof Error ? error.message : "Ошибка анализа", finishedAt: new Date() },
    });
    throw error;
  }
}
