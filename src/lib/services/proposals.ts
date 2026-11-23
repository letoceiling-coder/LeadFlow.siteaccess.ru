import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { completeJson } from "../integrations/openrouter";
import { isReady, requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { resolveTaskModel } from "../domain/models";
import { buildProposal, proposalAiSchema, proposalPrompt, proposalText, type Proposal } from "../domain/proposal";
import type { ObservationCard } from "../domain/qualify";
import { logEvent } from "../log";
import { activity, getSettings, recordCost } from "./common";
import { appBaseUrl } from "./opt-outs";
import { storedScan } from "./site-scan";

export function proposalUrl(token: string) {
  return `${appBaseUrl()}/kp/${token}`;
}

/** Ставит сборку КП в очередь — после ответа клиента, параллельно с диалогом. */
export async function enqueueProposal(tenantId: string, outreachId: string) {
  await enqueueJob({ tenantId, type: "hunt.proposal", payload: { outreachId }, idempotencyKey: `proposal:${outreachId}:${new Date().toISOString().slice(0, 13)}` });
}

/**
 * Собирает КП-презентацию: сценарий ниши + проверенные факты карточки + скан сайта.
 * AI (если доступен) переписывает только вступление, боль и следующий шаг. Ссылка постоянная: пересборка её не меняет.
 */
export async function generateProposal(outreachId: string, jobTenantId?: string) {
  const row = await prisma.outreach.findUnique({ where: { id: outreachId }, include: { organization: true } });
  if (!row || (jobTenantId && row.tenantId !== jobTenantId)) return null;
  const org = row.organization;
  let proposal = buildProposal({
    name: org.name,
    city: org.city,
    category: org.category,
    rating: org.rating,
    reviewCount: org.reviewCount,
    card: (row.card as unknown as ObservationCard | null) ?? null,
    site: storedScan(org.siteScan),
  });
  if (await isReady(row.tenantId, "openrouter")) {
    try {
      const integration = await requireReady(row.tenantId, "openrouter", "КП");
      const settings = await getSettings(row.tenantId);
      const prompt = proposalPrompt(proposal);
      const result = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, secrets: integration.secrets, model: resolveTaskModel("analysis", settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL), system: prompt.system, user: prompt.user, schema: proposalAiSchema, maxTokens: 700 });
      proposal = { ...proposal, ...result.data, ai: true };
      await recordCost({ tenantId: row.tenantId, provider: "openrouter", operation: "proposal", amountUsd: typeof result.usage.cost === "number" ? result.usage.cost : null, organizationId: org.id, refType: "outreach", refId: row.id });
    } catch (error) {
      logEvent("proposal.ai.skip", { outreachId, error: error instanceof Error ? error.message : String(error) }, "warn");
    }
  }
  const token = row.proposalToken ?? randomBytes(12).toString("base64url");
  await prisma.outreach.update({ where: { id: row.id }, data: { proposal: proposal as unknown as Prisma.InputJsonValue, proposalToken: token, proposalAt: new Date() } });
  await activity({ tenantId: row.tenantId, organizationId: org.id, actorId: null, type: "outreach.proposal", message: `КП собрано${proposal.ai ? " (AI)" : ""}: ${proposal.title}` });
  return { token, url: proposalUrl(token), proposal };
}

/** Ручная пересборка из карточки лида. */
export async function rebuildProposal(tenantId: string, outreachId: string) {
  const row = await prisma.outreach.findFirst({ where: { id: outreachId, tenantId }, select: { id: true } });
  if (!row) throw new ApiError(404, "Карточка не найдена", "not_found");
  const result = await generateProposal(outreachId, tenantId);
  if (!result) throw new ApiError(404, "Карточка не найдена", "not_found");
  return { url: result.url, text: proposalText(result.proposal, result.url), proposal: result.proposal };
}

/** Публичная страница КП по токену. Открывает клиент — без входа. */
export async function publicProposal(token: string) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return null;
  const row = await prisma.outreach.findUnique({ where: { proposalToken: token }, select: { id: true, tenantId: true, organizationId: true, proposal: true } });
  if (!row?.proposal) return null;
  const settings = await getSettings(row.tenantId);
  return { proposal: row.proposal as unknown as Proposal, reply: settings.reply, outreachId: row.id, tenantId: row.tenantId, organizationId: row.organizationId };
}

/** Отметка «клиент открыл КП» — раз в час, чтобы не засорять историю. */
export async function markProposalViewed(tenantId: string, organizationId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.activity.findFirst({ where: { tenantId, organizationId, type: "outreach.proposal_view", createdAt: { gte: since } }, select: { id: true } });
  if (!recent) await activity({ tenantId, organizationId, actorId: null, type: "outreach.proposal_view", message: "Клиент открыл КП" });
}
