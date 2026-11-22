import "server-only";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { decideSend, personalizeTemplate } from "../domain/compliance";
import { OPT_OUT_STOP } from "../domain/offer";
import { requireReady, resolveIntegration } from "../integrations/config";
import { deliverMessage } from "../integrations/channels";
import { resolveTaskModel } from "../domain/models";
import { completeJson } from "../integrations/openrouter";
import { z } from "zod";
import { assertBudget, audit, getSettings, moveLead } from "./common";
import type { ProviderId } from "../integrations/catalog";

const CHANNEL_PROVIDER: Record<string, ProviderId | null> = {
  email: "email",
  telegram: "telegram",
  whatsapp: "whatsapp",
  sms: "sms",
  test: null,
};

function keysFor(organizationId: string, contacts: { type: string; value: string }[]) {
  return [
    `org:${organizationId}`,
    ...contacts.map((contact) => (contact.type === "phone" ? contact.value.replace(/\D/g, "") : contact.value.toLowerCase())),
  ];
}

export async function suppressed(tenantId: string, organizationId: string, channel: string, contacts: { type: string; value: string }[]) {
  const values = keysFor(organizationId, contacts);
  const hit = await prisma.suppressionEntry.findFirst({
    where: { tenantId, value: { in: values }, OR: [{ channel: "*" }, { channel }] },
  });
  return Boolean(hit);
}

export async function draftMessage(tenantId: string, userId: string, input: { organizationId: string; channel: string; templateId?: string; body?: string; useAi?: boolean }) {
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, tenantId }, include: { contacts: true, sites: { take: 1, orderBy: { createdAt: "desc" } } } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  if (organization.isDemo) throw new ApiError(409, "По демонстрационной карточке сообщение не готовится как реальное.", "demo_blocked");
  const facts: Record<string, string | null> = {
    name: organization.name,
    city: organization.city,
    category: organization.category,
    rating: organization.rating == null ? null : String(organization.rating),
    website: organization.websiteStatus === "NO_WEBSITE" ? "собственный сайт в карточке не указан" : organization.website,
  };
  let body = input.body?.trim() || "";
  if (!body && input.templateId) {
    const template = await prisma.messageTemplate.findFirst({ where: { id: input.templateId, tenantId } });
    if (!template) throw new ApiError(404, "Шаблон не найден", "not_found");
    body = personalizeTemplate(template.body, facts).text;
  }
  if (input.useAi) {
    const settings = await getSettings(tenantId);
    const integration = await requireReady(tenantId, "openrouter", "Черновик сообщения");
    await assertBudget(tenantId, 0.03);
    const model = resolveTaskModel("message", settings.ai.messageModel);
    const result = await completeJson({
      baseUrl: String(integration.config.baseUrl),
      apiKey: integration.secrets.apiKey,
      model,
      maxTokens: 500,
      schema: z.object({ text: z.string().min(20).max(1200) }),
      system: "Напиши короткое деловое сообщение на русском. Используй только переданные факты. Не выдумывай контакты, цены и отношения с организацией. Не представляйся Яндексом. Верни JSON {text}.",
      user: JSON.stringify({ organization: facts, demoStatus: organization.sites[0]?.status ?? "сайта ещё нет", instruction: "Предложить посмотреть демонстрационный макет, если он готов. Не обещать публикацию." }),
    });
    body = result.data.text;
  }
  if (!body) {
    body = [`Здравствуйте.`, `Пишем по организации «${organization.name}»${organization.city ? `, ${organization.city}` : ""}.`, organization.websiteStatus === "NO_WEBSITE" ? "В открытой карточке не указан собственный сайт." : "", "Можем показать демонстрационный макет и обсудить, нужен ли он вам.", "Если писать не нужно, ответьте «отказ»."].filter(Boolean).join("\n");
  }
  const conversation = await prisma.conversation.create({
    data: { tenantId, organizationId: organization.id, channel: input.channel, subject: organization.name, assigneeId: userId },
  });
  const message = await prisma.message.create({
    data: { tenantId, conversationId: conversation.id, direction: "outbound", channel: input.channel, body, status: "draft" },
  });
  await audit({ tenantId, actorId: userId, action: "message.draft", entityType: "message", entityId: message.id });
  return { conversation, message };
}

export async function approveMessage(tenantId: string, userId: string, messageId: string, lawfulBasis: string, basisNote?: string) {
  const message = await prisma.message.findFirst({ where: { id: messageId, tenantId }, include: { conversation: true } });
  if (!message) throw new ApiError(404, "Сообщение не найдено", "not_found");
  if (lawfulBasis === "other_lawful" && (basisNote?.trim().length ?? 0) < 10) {
    throw new ApiError(400, "Опишите иное законное основание", "basis_required");
  }
  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { status: "approved", lawfulBasis, basisNote, approvedById: userId, approvedAt: new Date() },
  });
  if (message.conversation.organizationId) {
    await prisma.consentRecord.create({
      data: { tenantId, organizationId: message.conversation.organizationId, basis: lawfulBasis, note: basisNote, recordedById: userId },
    });
  }
  await audit({ tenantId, actorId: userId, action: "message.approve", entityType: "message", entityId: message.id });
  return updated;
}

export async function sendApprovedMessage(messageId: string, actorId?: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!message) throw new ApiError(404, "Сообщение не найдено", "not_found");
  if (message.status === "sent" || message.status === "sent_test") return message;
  const organizationId = message.conversation.organizationId;
  if (!organizationId) throw new ApiError(409, "У диалога нет организации", "org_required");
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId: message.tenantId }, include: { contacts: true, lead: { include: { stage: true } } } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  const optedOut = await prisma.optOut.findUnique({ where: { organizationId } });
  if (optedOut || organization.lead?.stage.key === "do_not_contact") {
    await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: OPT_OUT_STOP } });
    throw new ApiError(409, OPT_OUT_STOP, "opt_out");
  }
  const settings = await getSettings(message.tenantId);
  const since = new Date(Date.now() - settings.communication.windowDays * 24 * 60 * 60 * 1000);
  const recentCount = await prisma.message.count({
    where: {
      tenantId: message.tenantId,
      direction: "outbound",
      status: { in: ["sent", "sent_test"] },
      sentAt: { gte: since },
      conversation: { organizationId },
    },
  });
  const provider = CHANNEL_PROVIDER[message.channel];
  const integration = provider ? await resolveIntegration(message.tenantId, provider) : null;
  const decision = decideSend({
    approved: message.status === "approved" || message.status === "queued",
    suppressed: await suppressed(message.tenantId, organization.id, message.channel, organization.contacts),
    doNotContact: organization.lead?.stage.key === "do_not_contact",
    channel: message.channel,
    channelConnected: message.channel === "test" ? true : Boolean(integration?.status === "connected"),
    lawfulBasis: message.lawfulBasis,
    basisNote: message.basisNote,
    recentCount,
    limit: settings.communication.maxPerOrgPerDays,
    campaign: false,
    campaignApproved: false,
    legalBasisConfirmed: false,
  });
  if (!decision.ok) {
    await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: decision.reason } });
    throw new ApiError(409, decision.reason, "send_blocked");
  }
  const contact = organization.contacts.find((item) => (message.channel === "email" ? item.type === "email" : item.type === "phone"));
  if (message.channel !== "test" && message.channel !== "telegram" && !contact) {
    throw new ApiError(409, "В карточке нет контакта для выбранного канала. Адрес не будет выдуман.", "contact_missing");
  }
  if (message.channel === "test") {
    return prisma.message.update({ where: { id: message.id }, data: { status: "sent_test", sentAt: new Date(), error: "Тестовый канал: наружу ничего не отправлено" } });
  }
  try {
    const delivered = await deliverMessage(integration!, { to: contact?.value || "", subject: organization.name, body: message.body });
    const saved = await prisma.message.update({ where: { id: message.id }, data: { status: "sent", sentAt: new Date(), externalId: delivered.externalId, error: null } });
    await moveLead(message.tenantId, organization.id, "contacted", actorId);
    await audit({ tenantId: message.tenantId, actorId, action: "message.sent", entityType: "message", entityId: message.id });
    return saved;
  } catch (error) {
    await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: error instanceof Error ? error.message : "Ошибка отправки" } });
    throw error;
  }
}
