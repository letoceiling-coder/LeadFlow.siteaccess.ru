import "server-only";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { optOutSecret } from "../crypto";
import { buildCommercialOffer, formatPhone, maxLink, OFFER_TEMPLATE_NAME, offerTemplateBody, OPT_OUT_STOP, signOptOut, telegramLink, type OfferReply } from "../domain/offer";
import { siteFactFromStatus, type OfferFormat } from "../domain/offer-content";
import { captureOfferShots } from "./offer-shots";
import type { ProviderId } from "../integrations/catalog";
import { deliverMessage } from "../integrations/channels";
import { resolveIntegration } from "../integrations/config";
import { audit, getSettings } from "./common";
import { suppressed } from "./communications";
import { appBaseUrl, isOptedOut } from "./opt-outs";

const SEND_CHANNELS: { provider: ProviderId; channel: string; needs: "email" | "phone" | "chat" }[] = [
  { provider: "email", channel: "email", needs: "email" },
  { provider: "telegram", channel: "telegram", needs: "chat" },
  { provider: "whatsapp", channel: "whatsapp", needs: "phone" },
  { provider: "sms", channel: "sms", needs: "phone" },
];

async function offerReply(tenantId: string): Promise<OfferReply & { mailbox: string | null }> {
  const settings = await getSettings(tenantId);
  const email = await resolveIntegration(tenantId, "email");
  const mailbox = email.status === "connected" ? email.secrets.from || email.secrets.user || "" : "";
  return {
    phone: formatPhone(settings.reply.phone),
    telegram: telegramLink(settings.reply.telegram),
    max: maxLink(settings.reply.max),
    email: settings.reply.email.trim() || mailbox || null,
    mailbox: mailbox || null,
  };
}

export async function listSendChannels(tenantId: string) {
  const channels = [];
  for (const item of SEND_CHANNELS) {
    const integration = await resolveIntegration(tenantId, item.provider);
    channels.push({ channel: item.channel, connected: integration.status === "connected", needs: item.needs });
  }
  return channels;
}

async function loadOrganization(tenantId: string, organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, tenantId },
    include: { contacts: true, lead: { include: { stage: true } }, sites: { where: { publicUrl: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  if (organization.isDemo) throw new ApiError(409, "По демонстрационной карточке предложение не готовится.", "demo_blocked");
  return organization;
}

async function stopReason(tenantId: string, organization: { id: string; contacts: { type: string; value: string }[]; lead: { stage: { key: string } } | null }) {
  if ((await isOptedOut(tenantId, organization.id)) || organization.lead?.stage.key === "do_not_contact") return OPT_OUT_STOP;
  if (await suppressed(tenantId, organization.id, "email", organization.contacts)) return "Организация или контакт есть в списке отказов.";
  return null;
}

async function ensureOfferTemplate(tenantId: string) {
  const body = offerTemplateBody();
  const existing = await prisma.messageTemplate.findFirst({ where: { tenantId, name: OFFER_TEMPLATE_NAME, channel: "email" } });
  if (!existing) {
    await prisma.messageTemplate.create({ data: { tenantId, name: OFFER_TEMPLATE_NAME, channel: "email", body } });
    return;
  }
  if (existing.body !== body) await prisma.messageTemplate.update({ where: { id: existing.id }, data: { body } });
}

async function renderOffer(
  tenantId: string,
  organization: { id: string; name: string; city: string | null; category: string | null; websiteStatus?: string; contacts?: { type: string }[]; sites: { publicUrl: string | null }[] },
  messageId: string,
  format: OfferFormat = "compact",
) {
  const reply = await offerReply(tenantId);
  const optOutUrl = `${appBaseUrl()}/opt-out/${signOptOut({ tenantId, organizationId: organization.id, messageId }, optOutSecret())}`;
  const siteUrl = organization.sites[0]?.publicUrl || "";
  const shots = /^https:\/\//i.test(siteUrl) ? await captureOfferShots(siteUrl).catch(() => ({ desktop: null, mobile: null })) : { desktop: null, mobile: null };
  const built = buildCommercialOffer({
    name: organization.name,
    city: organization.city,
    category: organization.category,
    siteUrl,
    optOutUrl,
    reply,
    format,
    siteFact: siteFactFromStatus(organization.websiteStatus),
    hasSocial: organization.websiteStatus === "SOCIAL_ONLY" || Boolean(organization.contacts?.some((item) => item.type === "social")),
    desktopShot: shots.desktop,
    mobileShot: shots.mobile,
  });
  if ("error" in built) return { error: built.error };
  return { reply, letter: built, optOutUrl };
}

async function composeOffer(tenantId: string, userId: string, organizationId: string, status: "draft" | "approved", basisNote: string, format: OfferFormat = "compact") {
  const organization = await loadOrganization(tenantId, organizationId);
  const stopped = await stopReason(tenantId, organization);
  if (stopped) return { organizationId, name: organization.name, error: stopped };
  await ensureOfferTemplate(tenantId);
  const conversation = await prisma.conversation.create({
    data: { tenantId, organizationId: organization.id, channel: "email", subject: "Предложение", assigneeId: userId },
  });
  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      direction: "outbound",
      channel: "email",
      body: "Черновик предложения",
      status,
      lawfulBasis: status === "approved" ? "other_lawful" : null,
      basisNote: status === "approved" ? basisNote : null,
      approvedById: status === "approved" ? userId : null,
      approvedAt: status === "approved" ? new Date() : null,
    },
  });
  const rendered = await renderOffer(tenantId, organization, message.id, format);
  if ("error" in rendered) {
    await prisma.conversation.delete({ where: { id: conversation.id } });
    return { organizationId, name: organization.name, error: rendered.error };
  }
  await prisma.conversation.update({ where: { id: conversation.id }, data: { subject: rendered.letter.subject } });
  await prisma.message.update({ where: { id: message.id }, data: { body: rendered.letter.text } });
  return { organization, message, rendered };
}

export async function prepareOffer(tenantId: string, userId: string, organizationId: string, format: OfferFormat = "compact") {
  const composed = await composeOffer(tenantId, userId, organizationId, "draft", "", format);
  if ("error" in composed) return composed;
  const channels = await listSendChannels(tenantId);
  const email = composed.organization.contacts.find((item) => item.type === "email")?.value || null;
  await audit({ tenantId, actorId: userId, action: "offer.prepare", entityType: "message", entityId: composed.message.id });
  return {
    organizationId,
    name: composed.organization.name,
    messageId: composed.message.id,
    subject: composed.rendered.letter.subject,
    preheader: composed.rendered.letter.preheader,
    format,
    body: composed.rendered.letter.text,
    html: composed.rendered.letter.html,
    siteUrl: composed.organization.sites[0]?.publicUrl,
    optOutUrl: composed.rendered.optOutUrl,
    recipientEmail: email,
    channels,
  };
}

export async function sendOffer(tenantId: string, userId: string, organizationId: string, target: "default" | "organization") {
  const organization = await loadOrganization(tenantId, organizationId);
  const stopped = await stopReason(tenantId, organization);
  if (stopped) return { organizationId, name: organization.name, error: stopped };
  const channels = (await listSendChannels(tenantId)).filter((item) => item.connected);
  if (!channels.length) return { organizationId, name: organization.name, error: "Нет подключённой интеграции для отправки." };
  const deliveries = [];
  if (target === "default") {
    const email = channels.find((item) => item.channel === "email");
    const reply = await offerReply(tenantId);
    if (!email || !reply.mailbox) return { organizationId, name: organization.name, error: "Почта не подключена, тестовую копию отправить некуда." };
    const composed = await composeOffer(tenantId, userId, organizationId, "approved", "Тестовая копия коммерческого предложения на почту рабочего пространства. Организации письмо не отправлялось.");
    if ("error" in composed) return composed;
    const integration = await resolveIntegration(tenantId, "email");
    const delivered = await deliverMessage(integration, {
      to: reply.mailbox,
      subject: composed.rendered.letter.subject,
      body: composed.rendered.letter.text,
      html: composed.rendered.letter.html,
      listUnsubscribe: composed.rendered.optOutUrl,
    });
    await prisma.message.update({ where: { id: composed.message.id }, data: { status: "sent_test", sentAt: new Date(), externalId: delivered.externalId } });
    await audit({ tenantId, actorId: userId, action: "offer.test", entityType: "message", entityId: composed.message.id });
    deliveries.push({ channel: "email", to: "почта рабочего пространства", status: "sent_test" });
    return { organizationId, name: organization.name, subject: composed.rendered.letter.subject, siteUrl: organization.sites[0]?.publicUrl, deliveries };
  }

  const settings = await getSettings(tenantId);
  const since = new Date(Date.now() - settings.communication.windowDays * 24 * 60 * 60 * 1000);
  const recentCount = await prisma.message.count({
    where: { tenantId, direction: "outbound", status: "sent", sentAt: { gte: since }, conversation: { organizationId } },
  });
  if (recentCount >= settings.communication.maxPerOrgPerDays) {
    return { organizationId, name: organization.name, error: "Этой организации уже отправляли сообщение в заданный период." };
  }
  let subject = "";
  for (const channel of channels) {
    if (channel.needs === "chat") {
      deliveries.push({ channel: channel.channel, status: "skipped", error: "Для этого канала в карточке нет идентификатора чата." });
      continue;
    }
    const contact = organization.contacts.find((item) => item.type === (channel.needs === "email" ? "email" : "phone"));
    if (!contact) {
      deliveries.push({ channel: channel.channel, status: "skipped", error: "В карточке нет контакта этого канала. Адрес не выдумывается." });
      continue;
    }
    const composed = await composeOffer(tenantId, userId, organizationId, "approved", "Администратор в диалоге агента попросил отправить предложение на контакт из карточки.");
    if ("error" in composed) return composed;
    subject = composed.rendered.letter.subject;
    const integration = await resolveIntegration(tenantId, channel.channel as ProviderId);
    try {
      const delivered = await deliverMessage(integration, {
        to: contact.value,
        subject: composed.rendered.letter.subject,
        body: composed.rendered.letter.text,
        html: channel.channel === "email" ? composed.rendered.letter.html : undefined,
        listUnsubscribe: channel.channel === "email" ? composed.rendered.optOutUrl : undefined,
      });
      await prisma.message.update({ where: { id: composed.message.id }, data: { status: "sent", sentAt: new Date(), externalId: delivered.externalId, channel: channel.channel } });
      await prisma.conversation.update({ where: { id: composed.message.conversationId }, data: { channel: channel.channel } });
      deliveries.push({ channel: channel.channel, to: contact.value, status: "sent" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Отправка не выполнена.";
      await prisma.message.update({ where: { id: composed.message.id }, data: { status: "failed", error: reason, channel: channel.channel } });
      deliveries.push({ channel: channel.channel, status: "failed", error: reason });
    }
  }
  await audit({ tenantId, actorId: userId, action: "offer.send", entityType: "organization", entityId: organization.id });
  return { organizationId, name: organization.name, subject, siteUrl: organization.sites[0]?.publicUrl, deliveries };
}
