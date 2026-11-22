import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { personalizeTemplate } from "../domain/compliance";
import { enqueueJob } from "../jobs/queue";
import { audit } from "./common";
import { OPT_OUT_STOP } from "../domain/offer";
import { sendApprovedMessage, suppressed } from "./communications";

export async function previewAudience(tenantId: string, filters: Record<string, unknown>, channel: string) {
  const where: Prisma.OrganizationWhereInput = { tenantId, isDemo: false };
  if (typeof filters.city === "string" && filters.city) where.city = { equals: filters.city, mode: "insensitive" };
  if (typeof filters.category === "string" && filters.category) where.category = { equals: filters.category, mode: "insensitive" };
  if (filters.noWebsite === true) where.websiteStatus = "NO_WEBSITE";
  if (typeof filters.minScore === "number") where.leadScore = { gte: filters.minScore };
  const organizations = await prisma.organization.findMany({ where, include: { contacts: true, lead: { include: { stage: true } } }, take: 500 });
  const optedOut = new Set((await prisma.optOut.findMany({ where: { tenantId }, select: { organizationId: true } })).map((item) => item.organizationId));
  const recipients = [];
  for (const organization of organizations) {
    const contact = organization.contacts.find((item) => (channel === "email" ? item.type === "email" : channel === "test" ? true : item.type === "phone"));
    const blocked = organization.lead?.stage.key === "do_not_contact" || optedOut.has(organization.id) || (await suppressed(tenantId, organization.id, channel, organization.contacts));
    let reason: string | null = null;
    if (organization.lead?.stage.key === "do_not_contact" || optedOut.has(organization.id)) reason = OPT_OUT_STOP;
    else if (blocked) reason = "Список отказов";
    else if (channel !== "test" && !contact) reason = "Нет подходящего контакта";
    recipients.push({
      organizationId: organization.id,
      name: organization.name,
      contact: contact?.value ?? null,
      eligible: !reason,
      reason,
    });
  }
  return {
    audienceCount: recipients.length,
    eligibleCount: recipients.filter((item) => item.eligible).length,
    excludedCount: recipients.filter((item) => !item.eligible).length,
    recipients,
  };
}

export async function createCampaign(tenantId: string, userId: string, input: { name: string; channel: string; templateId?: string; filters: Record<string, unknown>; lawfulBasis?: string; basisNote?: string }) {
  const preview = await previewAudience(tenantId, input.filters, input.channel);
  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: input.name,
      channel: input.channel,
      templateId: input.templateId,
      filters: input.filters as Prisma.InputJsonValue,
      lawfulBasis: input.lawfulBasis,
      basisNote: input.basisNote,
      audienceCount: preview.audienceCount,
      eligibleCount: preview.eligibleCount,
      excludedCount: preview.excludedCount,
      createdById: userId,
      status: "draft",
    },
  });
  await prisma.campaignRecipient.createMany({
    data: preview.recipients.map((item) => ({
      campaignId: campaign.id,
      organizationId: item.organizationId,
      contactValue: item.contact,
      status: item.eligible ? "eligible" : "excluded",
      reason: item.reason,
    })),
  });
  await audit({ tenantId, actorId: userId, action: "campaign.create", entityType: "campaign", entityId: campaign.id });
  return { campaign, preview };
}

export async function approveCampaign(tenantId: string, userId: string, id: string, lawfulBasis: string, basisNote?: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) throw new ApiError(404, "Кампания не найдена", "not_found");
  if (lawfulBasis === "other_lawful" && (basisNote?.trim().length ?? 0) < 10) {
    throw new ApiError(400, "Опишите правовое основание кампании", "basis_required");
  }
  return prisma.campaign.update({
    where: { id },
    data: { status: "approved", legalBasisConfirmed: true, lawfulBasis, basisNote, approvedById: userId },
  });
}

export async function setCampaignStatus(tenantId: string, id: string, status: "running" | "paused" | "cancelled") {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) throw new ApiError(404, "Кампания не найдена", "not_found");
  if (status === "running") {
    if (campaign.status !== "approved" && campaign.status !== "paused") {
      throw new ApiError(409, "Кампанию можно запустить только после утверждения.", "approval_required");
    }
    if (!campaign.legalBasisConfirmed) throw new ApiError(409, "Не подтверждено правовое основание.", "basis_required");
    await prisma.campaign.update({ where: { id }, data: { status: "running" } });
    await enqueueJob({ tenantId, type: "campaign.send", payload: { campaignId: id }, idempotencyKey: `campaign:${id}:${Date.now()}` });
    return { status: "running" };
  }
  return prisma.campaign.update({ where: { id }, data: { status } });
}

export async function sendNextRecipient(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { recipients: true } });
  if (!campaign || campaign.status !== "running") return { done: true };
  const recipient = campaign.recipients.find((item) => item.status === "eligible");
  if (!recipient) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "completed" } });
    return { done: true };
  }
  const organization = await prisma.organization.findUnique({ where: { id: recipient.organizationId } });
  const template = campaign.templateId ? await prisma.messageTemplate.findUnique({ where: { id: campaign.templateId } }) : null;
  const body = personalizeTemplate(template?.body || "Здравствуйте, {{name}}. Можем показать демонстрационный макет сайта.", {
    name: organization?.name,
    city: organization?.city,
    category: organization?.category,
  }).text;
  const conversation = await prisma.conversation.create({
    data: { tenantId: campaign.tenantId, organizationId: recipient.organizationId, channel: campaign.channel, subject: campaign.name },
  });
  const message = await prisma.message.create({
    data: {
      tenantId: campaign.tenantId,
      conversationId: conversation.id,
      direction: "outbound",
      channel: campaign.channel,
      body,
      status: "approved",
      lawfulBasis: campaign.lawfulBasis,
      basisNote: campaign.basisNote,
      approvedById: campaign.approvedById,
      approvedAt: new Date(),
    },
  });
  try {
    await sendApprovedMessage(message.id, campaign.approvedById ?? undefined);
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "sent", personalizedBody: body, messageId: message.id } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { sentCount: { increment: 1 } } });
  } catch (error) {
    await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "failed", reason: error instanceof Error ? error.message : "Ошибка" } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { errorCount: { increment: 1 } } });
  }
  return { done: false, continue: true };
}
