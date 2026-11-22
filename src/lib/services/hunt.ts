import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { resolveTaskModel } from "../domain/models";
import { completeJson } from "../integrations/openrouter";
import { isReady, requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { activity, assertBudget, audit, getSettings, moveLead, recordCost } from "./common";
import {
  QUALIFY_PROMPT_VERSION,
  QUALIFY_THRESHOLD,
  buildCard,
  buildQualifyPrompt,
  qualifyResultSchema,
  strategyScore,
  type ObservationCard,
  type QualifyFacts,
  type QualifyResult,
} from "../domain/qualify";
import { bannedIn, buildPitch, contactLinks, followUpText, nextFollowUpAt } from "../domain/pitch";
import { detectSegment, segmentInfo } from "../domain/segments";

/* ───────────── Квалификация ───────────── */

type OrgWithContacts = Prisma.OrganizationGetPayload<{ include: { contacts: true } }>;

function factsOf(org: OrgWithContacts): QualifyFacts {
  return {
    name: org.name,
    category: org.category,
    categories: org.categories,
    city: org.city,
    address: org.address,
    website: org.website,
    websiteStatus: org.websiteStatus,
    rating: org.rating,
    reviewCount: org.reviewCount,
    photoCount: org.photoCount,
    services: org.services.slice(0, 40),
    features: org.features.slice(0, 40),
    description: org.description ? org.description.slice(0, 1500) : null,
    sourceUrl: org.sourceUrl,
    phones: org.contacts.filter((item) => item.type === "phone").map((item) => item.value),
    emails: org.contacts.filter((item) => item.type === "email").map((item) => item.value),
    socials: org.contacts.filter((item) => item.type === "social").map((item) => item.value),
  };
}

export async function enqueueQualify(tenantId: string, actorId: string | null, organizationIds: string[], confirmLarge = false) {
  const settings = await getSettings(tenantId);
  const ids = [...new Set(organizationIds)];
  if (ids.length > 10 && settings.confirm.expensiveAi && !confirmLarge) {
    throw new ApiError(409, `Квалификация ${ids.length} карточек использует платный AI. Подтвердите запуск.`, "confirm_required");
  }
  const orgs = await prisma.organization.findMany({ where: { tenantId, id: { in: ids }, isDemo: false }, select: { id: true, category: true, categories: true } });
  let queued = 0;
  for (const org of orgs) {
    const existing = await prisma.outreach.findUnique({ where: { organizationId: org.id } });
    if (existing?.cardStatus === "queued") continue;
    await prisma.outreach.upsert({
      where: { organizationId: org.id },
      update: { cardStatus: "queued", error: null },
      create: { tenantId, organizationId: org.id, cardStatus: "queued", segment: detectSegment(org.category, org.categories) },
    });
    await enqueueJob({ tenantId, type: "hunt.qualify", payload: { organizationId: org.id }, idempotencyKey: `qualify:${org.id}:${Date.now()}` });
    queued += 1;
  }
  if (actorId) await audit({ tenantId, actorId, action: "hunt.qualify", meta: { queued } });
  return { queued };
}

/** Новые карточки без квалификации: сначала активные сегменты и больше отзывов. */
export async function qualifyPending(tenantId: string, actorId: string | null, limit: number, confirmLarge = false) {
  const settings = await getSettings(tenantId);
  const candidates = await prisma.organization.findMany({
    where: { tenantId, isDemo: false, outreach: null, optOut: null },
    select: { id: true, category: true, categories: true, reviewCount: true },
    orderBy: [{ reviewCount: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 2000,
  });
  const active = new Set<string>(settings.hunt.activeSegments);
  const picked = candidates
    .map((item) => ({ ...item, segment: detectSegment(item.category, item.categories) }))
    .filter((item) => item.segment == null || active.has(item.segment))
    .sort((a, b) => Number(b.segment != null && active.has(b.segment)) - Number(a.segment != null && active.has(a.segment)))
    .slice(0, Math.max(1, Math.min(limit, 200)));
  if (!picked.length) return { queued: 0, left: 0 };
  const result = await enqueueQualify(tenantId, actorId, picked.map((item) => item.id), confirmLarge);
  return { ...result, left: Math.max(0, candidates.length - picked.length) };
}

/** После синхронизации поиска: авто-квалификация новых карточек, если включена и AI подключён. */
export async function autoQualifyNew(tenantId: string, organizationIds: string[]) {
  if (!organizationIds.length) return;
  const settings = await getSettings(tenantId);
  if (!settings.hunt.autoQualify || settings.hunt.autoQualifyMax <= 0) return;
  if (!(await isReady(tenantId, "openrouter"))) return;
  const active = new Set<string>(settings.hunt.activeSegments);
  const orgs = await prisma.organization.findMany({ where: { tenantId, id: { in: organizationIds }, isDemo: false }, select: { id: true, category: true, categories: true } });
  const ids = orgs
    .filter((item) => {
      const segment = detectSegment(item.category, item.categories);
      return segment == null || active.has(segment);
    })
    .slice(0, settings.hunt.autoQualifyMax)
    .map((item) => item.id);
  if (ids.length) await enqueueQualify(tenantId, null, ids, true);
}

export async function runQualify(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { contacts: true } });
  if (!org) return;
  const tenantId = org.tenantId;
  const settings = await getSettings(tenantId);
  const facts = factsOf(org);
  let ai: QualifyResult | null = null;
  let model: string | null = null;
  let cost: number | null = null;
  let aiNote: string | null = null;

  if (await isReady(tenantId, "openrouter")) {
    const integration = await requireReady(tenantId, "openrouter", "Квалификация");
    await assertBudget(tenantId, settings.ai.maxCostPerAnalysisUsd);
    model = resolveTaskModel("analysis", settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL);
    const prompt = buildQualifyPrompt(facts);
    try {
      const result = await completeJson({
        baseUrl: String(integration.config.baseUrl),
        apiKey: integration.secrets.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        schema: qualifyResultSchema,
        maxTokens: 1200,
      });
      ai = result.data;
      cost = typeof result.usage.cost === "number" ? result.usage.cost : null;
      await recordCost({ tenantId, provider: "openrouter", operation: "qualify", amountUsd: cost, organizationId, refType: "outreach", refId: organizationId });
    } catch (error) {
      if (error instanceof ApiError && error.code === "ai_invalid_json") aiNote = "AI вернул неразборчивый ответ — карточка собрана только из данных источника.";
      else throw error;
    }
  } else {
    aiNote = "OpenRouter не подключён — карточка собрана только из данных источника.";
  }

  const card = buildCard(facts, ai);
  const scored = strategyScore(card, ai);
  const existing = await prisma.outreach.findUnique({ where: { organizationId } });
  const data = {
    segment: card.segment,
    score: scored.score,
    priority: scored.priority,
    factors: scored.factors as unknown as Prisma.InputJsonValue,
    card: { ...card, promptVersion: QUALIFY_PROMPT_VERSION } as unknown as Prisma.InputJsonValue,
    cardStatus: scored.ready ? "ready" : "no_fact",
    model,
    costUsd: cost,
    error: aiNote,
    qualifiedAt: new Date(),
  };
  if (existing) await prisma.outreach.update({ where: { id: existing.id }, data });
  else await prisma.outreach.create({ data: { tenantId, organizationId, ...data } });
  await prisma.leadScore.create({
    data: {
      tenantId,
      organizationId,
      score: scored.score,
      method: QUALIFY_PROMPT_VERSION,
      factors: scored.factors as unknown as Prisma.InputJsonValue,
      weights: {},
      explanation: `Приоритет ${scored.priority}. ${scored.ready ? "Карточка готова." : "Нет подтверждённого факта денег или хаоса — к отправке не допускается."}`,
    },
  });
}

export async function markQualifyFailed(organizationId: string, message: string) {
  await prisma.outreach.updateMany({ where: { organizationId, cardStatus: "queued" }, data: { cardStatus: "failed", error: message.slice(0, 500) } });
}

/* ───────────── Лента «Сегодня» ───────────── */

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

async function sentToday(tenantId: string) {
  return prisma.activity.count({ where: { tenantId, type: "outreach.sent", createdAt: { gte: startOfDay() } } });
}

const listInclude = { organization: { select: { id: true, name: true, city: true, category: true, rating: true, reviewCount: true, website: true, sourceUrl: true } } } as const;

export async function today(tenantId: string, limit = 10) {
  const settings = await getSettings(tenantId);
  const now = new Date();
  const where: Prisma.OutreachWhereInput = {
    tenantId,
    cardStatus: "ready",
    priority: { in: ["A", "B"] },
    OR: [{ status: "new" }, { status: "snoozed", snoozeUntil: { lte: now } }],
    organization: { optOut: null },
  };
  const [items, total, approved, followUps, queued, sent] = await Promise.all([
    prisma.outreach.findMany({ where, include: listInclude, orderBy: [{ priority: "asc" }, { score: "desc" }], take: Math.min(limit, 50) }),
    prisma.outreach.count({ where }),
    prisma.outreach.count({ where: { tenantId, status: "approved" } }),
    prisma.outreach.count({ where: { tenantId, status: "sent", nextFollowUpAt: { lte: endOfDay() } } }),
    prisma.outreach.count({ where: { tenantId, cardStatus: "queued" } }),
    sentToday(tenantId),
  ]);
  return {
    items: items.map(publicItem),
    total,
    approved,
    followUps,
    queued,
    sentToday: sent,
    dailyLimit: settings.hunt.dailyLimit,
    activeSegments: settings.hunt.activeSegments,
  };
}

type OutreachRow = Prisma.OutreachGetPayload<{ include: typeof listInclude }>;

function publicItem(row: OutreachRow) {
  return {
    id: row.id,
    organization: row.organization,
    segment: row.segment,
    segmentLabel: segmentInfo(row.segment)?.label ?? null,
    score: row.score,
    priority: row.priority,
    card: row.card as unknown as ObservationCard | null,
    cardStatus: row.cardStatus,
    status: row.status,
    rejectReason: row.rejectReason,
    sentAt: row.sentAt,
    followUpStep: row.followUpStep,
    nextFollowUpAt: row.nextFollowUpAt,
    repliedAt: row.repliedAt,
    channel: row.channel,
    error: row.error,
  };
}

async function owned(tenantId: string, id: string) {
  const row = await prisma.outreach.findFirst({ where: { id, tenantId }, include: { organization: { include: { contacts: true, optOut: true, lead: { include: { stage: true } } } } } });
  if (!row) throw new ApiError(404, "Карточка не найдена", "not_found");
  return row;
}

export const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "snooze"]),
  reason: z.string().trim().max(200).optional(),
  days: z.number().int().min(1).max(60).optional(),
});

export async function decide(tenantId: string, actorId: string, id: string, input: z.infer<typeof decisionSchema>) {
  const row = await owned(tenantId, id);
  if (input.action === "approve") {
    if (row.cardStatus !== "ready") throw new ApiError(409, "Без подтверждённых фактов карточку нельзя взять в работу.", "card_not_ready");
    await prisma.outreach.update({ where: { id }, data: { status: "approved", snoozeUntil: null } });
    await moveLead(tenantId, row.organizationId, "ready_to_contact", actorId);
  } else if (input.action === "reject") {
    await prisma.outreach.update({ where: { id }, data: { status: "rejected", rejectReason: input.reason || "Без причины" } });
    await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.rejected", message: `Отклонено: ${input.reason || "без причины"}` });
  } else {
    const until = new Date(Date.now() + (input.days ?? 3) * 24 * 60 * 60 * 1000);
    await prisma.outreach.update({ where: { id }, data: { status: "snoozed", snoozeUntil: until } });
  }
  return { ok: true };
}

/* ───────────── Питч и отправка ───────────── */

export async function getItem(tenantId: string, id: string) {
  const row = await owned(tenantId, id);
  const card = row.card as unknown as ObservationCard | null;
  const step = row.status === "sent" ? row.followUpStep + 1 : 0;
  const draft = row.pitch || (card ? buildPitch(card) : "");
  const followUp = row.status === "sent" ? followUpText(step) : null;
  const text = followUp ?? draft;
  return {
    id: row.id,
    organization: {
      id: row.organization.id,
      name: row.organization.name,
      city: row.organization.city,
      category: row.organization.category,
      address: row.organization.address,
      rating: row.organization.rating,
      reviewCount: row.organization.reviewCount,
      website: row.organization.website,
      sourceUrl: row.organization.sourceUrl,
      optedOut: Boolean(row.organization.optOut),
      stage: row.organization.lead?.stage.name ?? null,
    },
    segment: row.segment,
    segmentLabel: segmentInfo(row.segment)?.label ?? null,
    score: row.score,
    priority: row.priority,
    factors: row.factors,
    card,
    cardStatus: row.cardStatus,
    status: row.status,
    sentAt: row.sentAt,
    followUpStep: row.followUpStep,
    nextFollowUpAt: row.nextFollowUpAt,
    error: row.error,
    pitch: draft,
    followUp,
    banned: bannedIn(draft),
    links: contactLinks(card?.contact ?? row.organization.contacts.map((item) => ({ kind: item.type, value: item.value })), text),
  };
}

export const pitchSchema = z.object({ text: z.string().trim().min(10).max(2000) });

export async function savePitch(tenantId: string, id: string, text: string) {
  await owned(tenantId, id);
  const banned = bannedIn(text);
  if (banned.length) throw new ApiError(422, `Уберите фразы, которые режут ответы: ${banned.join(", ")}`, "banned_phrase");
  await prisma.outreach.update({ where: { id }, data: { pitch: text } });
  return { ok: true };
}

const rewriteSchema = z.object({ text: z.string().min(20).max(1500) });

export async function rewritePitch(tenantId: string, id: string) {
  const row = await owned(tenantId, id);
  const card = row.card as unknown as ObservationCard | null;
  if (!card || row.cardStatus !== "ready") throw new ApiError(409, "Сначала нужна готовая карточка с фактами.", "card_not_ready");
  const settings = await getSettings(tenantId);
  const integration = await requireReady(tenantId, "openrouter", "Переписать питч");
  await assertBudget(tenantId, settings.ai.maxCostPerBriefUsd);
  const model = resolveTaskModel("message", settings.ai.messageModel || process.env.AI_DEFAULT_MODEL);
  const draft = row.pitch || buildPitch(card);
  const system = [
    "Ты пишешь первое сообщение владельцу бизнеса. Цель — получить любой ответ, не продать.",
    "Скелет из трёх блоков: 1) крючок-факт «Увидел, что …. Верно?» 2) диагноз с цифрой потерь 3) мягкий оффер «Набросал, как это разгрузить … Скинуть глянуть?».",
    "До 600 символов, на «вы», без ссылок, без эмодзи, без цены.",
    "Запрещено: «мы делаем сайты», «сделаем сайт», «AI-агенты», «автоматизация», «интересный проект».",
    "Используй только факты из карточки. Верни JSON {\"text\": \"...\"}.",
  ].join(" ");
  const user = JSON.stringify({ organization: row.organization.name, city: row.organization.city, card, draft });
  const result = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, model, system, user, schema: rewriteSchema, maxTokens: 700 });
  const cost = typeof result.usage.cost === "number" ? result.usage.cost : null;
  await recordCost({ tenantId, provider: "openrouter", operation: "pitch", amountUsd: cost, organizationId: row.organizationId, refType: "outreach", refId: id });
  const text = result.data.text.trim();
  const banned = bannedIn(text);
  return { text: banned.length ? draft : text, banned, fallback: banned.length > 0 };
}

export const sentSchema = z.object({
  channel: z.enum(["telegram", "whatsapp", "vk", "email", "phone", "instagram", "avito", "other"]),
  text: z.string().trim().max(2000).optional(),
  force: z.boolean().optional(),
});

async function assertContactable(row: Awaited<ReturnType<typeof owned>>) {
  if (row.organization.optOut) throw new ApiError(409, "Организация отказалась от сообщений.", "opted_out");
  if (row.organization.lead?.stage.key === "do_not_contact") throw new ApiError(409, "Стадия «Не связываться».", "do_not_contact");
  const values = [`org:${row.organizationId}`, ...row.organization.contacts.map((item) => item.value.toLowerCase())];
  const hit = await prisma.suppressionEntry.findFirst({ where: { tenantId: row.tenantId, value: { in: values } } });
  if (hit) throw new ApiError(409, "Контакт в стоп-листе.", "suppressed");
}

/** Человек отправил первое сообщение сам. Система только записывает факт. */
export async function markSent(tenantId: string, actorId: string, id: string, input: z.infer<typeof sentSchema>) {
  const row = await owned(tenantId, id);
  if (!["approved", "new", "snoozed"].includes(row.status)) throw new ApiError(409, "Первое сообщение уже отмечено.", "already_sent");
  if (row.cardStatus !== "ready") throw new ApiError(409, "Без подтверждённых фактов писать нельзя.", "card_not_ready");
  await assertContactable(row);
  const text = input.text ?? row.pitch ?? "";
  const banned = bannedIn(text);
  if (banned.length) throw new ApiError(422, `Уберите фразы: ${banned.join(", ")}`, "banned_phrase");
  const settings = await getSettings(tenantId);
  const count = await sentToday(tenantId);
  if (count >= settings.hunt.dailyLimit && !input.force) {
    throw new ApiError(409, `Сегодня уже ${count} из ${settings.hunt.dailyLimit} новых касаний. Лимит защищает аккаунт от блокировки.`, "daily_limit");
  }
  const sentAt = new Date();
  await prisma.outreach.update({
    where: { id },
    data: { status: "sent", sentAt, channel: input.channel, pitch: text || row.pitch, followUpStep: 0, nextFollowUpAt: nextFollowUpAt(sentAt, 0) },
  });
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.sent", message: `Первое сообщение отправлено вручную (${input.channel})`, meta: { text: text.slice(0, 2000), channel: input.channel } });
  await moveLead(tenantId, row.organizationId, "contacted", actorId);
  return { ok: true, sentToday: count + 1, dailyLimit: settings.hunt.dailyLimit };
}

export async function followUpDone(tenantId: string, actorId: string, id: string, channel: string) {
  const row = await owned(tenantId, id);
  if (row.status !== "sent" || !row.sentAt) throw new ApiError(409, "Напоминание возможно только после первого сообщения без ответа.", "not_sent");
  await assertContactable(row);
  const step = row.followUpStep + 1;
  const next = nextFollowUpAt(row.sentAt, step);
  await prisma.outreach.update({ where: { id }, data: { followUpStep: step, nextFollowUpAt: next, status: next ? "sent" : "sleeping" } });
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.followup", message: `Follow-up ${step} отправлен вручную (${channel})` });
  return { ok: true, step, next };
}

export const STATUS_FLOW: Record<string, { label: string; stage: string | null }> = {
  replied: { label: "Ответил", stage: "replied" },
  call: { label: "Созвон", stage: "meeting" },
  estimate: { label: "Смета", stage: "proposal" },
  won: { label: "Сделка", stage: "won" },
  lost: { label: "Отказ", stage: "lost" },
  sleeping: { label: "Спящий", stage: null },
};

export const statusSchema = z.object({ status: z.enum(["replied", "call", "estimate", "won", "lost", "sleeping"]), note: z.string().trim().max(500).optional() });

export async function setStatus(tenantId: string, actorId: string, id: string, input: z.infer<typeof statusSchema>) {
  const row = await owned(tenantId, id);
  const flow = STATUS_FLOW[input.status];
  await prisma.outreach.update({
    where: { id },
    data: {
      status: input.status,
      nextFollowUpAt: null,
      repliedAt: input.status === "sleeping" || input.status === "lost" ? row.repliedAt : (row.repliedAt ?? new Date()),
    },
  });
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: `outreach.${input.status}`, message: `${flow.label}${input.note ? `: ${input.note}` : ""}` });
  if (flow.stage) await moveLead(tenantId, row.organizationId, flow.stage, actorId);
  return { ok: true };
}

/* ───────────── Диалоги и цифры ───────────── */

export async function dialogs(tenantId: string) {
  const [due, active, waiting, approved, sleeping] = await Promise.all([
    prisma.outreach.findMany({ where: { tenantId, status: "sent", nextFollowUpAt: { lte: endOfDay() } }, include: listInclude, orderBy: { nextFollowUpAt: "asc" }, take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: { in: ["replied", "call", "estimate"] } }, include: listInclude, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: "sent", OR: [{ nextFollowUpAt: { gt: endOfDay() } }, { nextFollowUpAt: null }] }, include: listInclude, orderBy: { sentAt: "desc" }, take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: "approved" }, include: listInclude, orderBy: [{ priority: "asc" }, { score: "desc" }], take: 50 }),
    prisma.outreach.count({ where: { tenantId, status: "sleeping" } }),
  ]);
  return { due: due.map(publicItem), active: active.map(publicItem), waiting: waiting.map(publicItem), approved: approved.map(publicItem), sleeping };
}

export async function stats(tenantId: string, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [touches, replies, calls, estimates, won, totalTouches, qualified, passed, bySegment] = await Promise.all([
    prisma.outreach.count({ where: { tenantId, sentAt: { gte: since } } }),
    prisma.outreach.count({ where: { tenantId, sentAt: { gte: since }, repliedAt: { not: null } } }),
    prisma.outreach.count({ where: { tenantId, sentAt: { gte: since }, status: { in: ["call", "estimate", "won"] } } }),
    prisma.outreach.count({ where: { tenantId, sentAt: { gte: since }, status: { in: ["estimate", "won"] } } }),
    prisma.outreach.count({ where: { tenantId, sentAt: { gte: since }, status: "won" } }),
    prisma.outreach.count({ where: { tenantId, sentAt: { not: null } } }),
    prisma.outreach.count({ where: { tenantId, qualifiedAt: { gte: since } } }),
    prisma.outreach.count({ where: { tenantId, qualifiedAt: { gte: since }, score: { gte: QUALIFY_THRESHOLD }, cardStatus: "ready" } }),
    prisma.outreach.groupBy({ by: ["segment"], where: { tenantId, sentAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const replyRate = touches ? replies / touches : null;
  const passRate = qualified ? passed / qualified : null;
  const advice: string[] = [];
  if (passRate != null && qualified >= 20 && passRate < 0.4) advice.push("Меньше 40% карточек набирают 60+ баллов — поменяйте ключевые слова или источники поиска.");
  if (replyRate != null && touches >= 20 && replyRate < 0.08) advice.push("Ответов меньше 8% — перепишите крючок (первый блок) и проверьте, что в профиле есть кейсы.");
  if (replyRate != null && replyRate >= 0.08 && replies >= 4 && calls < replies / 2) advice.push("Отвечают, но до созвона доходит меньше половины — усильте фильтр «есть деньги».");
  if (calls >= 3 && estimates > 0 && won === 0) advice.push("Сметы висят — показывайте живое демо на каждом созвоне и давайте 2 варианта в смете.");
  if (totalTouches >= 400) advice.push("Набрано 400 касаний — время решать: масштабировать, менять текст или менять сегмент.");
  return {
    days,
    touches,
    replies,
    calls,
    estimates,
    won,
    replyRate,
    qualified,
    passed,
    passRate,
    totalTouches,
    bySegment: bySegment.map((item) => ({ segment: item.segment, label: segmentInfo(item.segment)?.label ?? "Без сегмента", count: item._count._all })),
    advice,
  };
}
