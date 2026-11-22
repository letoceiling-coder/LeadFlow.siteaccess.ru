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
  addManualFact,
  buildCard,
  buildQualifyPrompt,
  flagsFromFactors,
  isIncomplete,
  qualifyResultSchema,
  strategyScore,
  type ObservationCard,
  type QualifyFacts,
  type QualifyResult,
  type StrategyFactor,
} from "../domain/qualify";
import { FOLLOW_UP_DAYS, bannedIn, buildPitch, contactLinks, followUpText, nextFollowUpAt } from "../domain/pitch";
import { detectSegment, segmentInfo } from "../domain/segments";
import { dayBounds } from "../domain/time";
import { queueSheet } from "./sheets";

/** Статусы, в которых карточку ещё можно (пере)квалифицировать, взять, отклонить или отложить. Дальше — живой диалог. */
const OPEN = ["new", "snoozed", "approved", "rejected"];
const DAY = 24 * 60 * 60 * 1000;
/** Живой диалог: после ответа у каждого шага есть срок (§3: созвон в течение суток, смета +24ч). */
const LIVE = ["replied", "demo", "call", "estimate"];
const NEXT_STEP_HOURS: Record<string, number> = { replied: 24, demo: 48, call: 24, estimate: 72 };

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

async function hasLiveQualifyJob(tenantId: string, organizationId: string) {
  const job = await prisma.job.findFirst({
    where: { tenantId, type: "hunt.qualify", status: { in: ["queued", "running"] }, payload: { path: ["organizationId"], equals: organizationId } },
    select: { id: true },
  });
  return Boolean(job);
}

export async function enqueueQualify(tenantId: string, actorId: string | null, organizationIds: string[], confirmLarge = false) {
  const settings = await getSettings(tenantId);
  const ids = [...new Set(organizationIds)];
  if (ids.length > 10 && settings.confirm.expensiveAi && !confirmLarge) {
    throw new ApiError(409, `Квалификация ${ids.length} карточек использует платный AI. Подтвердите запуск.`, "confirm_required");
  }
  const orgs = await prisma.organization.findMany({
    where: { tenantId, id: { in: ids }, isDemo: false, optOut: null },
    select: { id: true, category: true, categories: true, outreach: { select: { status: true, cardStatus: true } } },
  });
  let queued = 0;
  let skipped = 0;
  for (const org of orgs) {
    // Карточки в живом диалоге не трогаем: повторная квалификация могла бы спрятать напоминание.
    if (org.outreach && !OPEN.includes(org.outreach.status)) { skipped += 1; continue; }
    if (org.outreach?.cardStatus === "queued" && (await hasLiveQualifyJob(tenantId, org.id))) { skipped += 1; continue; }
    // Сначала «в очереди», потом задача: иначе быстрый обработчик успел бы поставить «готово», а upsert вернул бы «в очереди».
    await prisma.outreach.upsert({
      where: { organizationId: org.id },
      update: { cardStatus: "queued", error: null },
      create: { tenantId, organizationId: org.id, cardStatus: "queued", segment: detectSegment(org.category, org.categories) },
    });
    await enqueueJob({ tenantId, type: "hunt.qualify", payload: { organizationId: org.id }, idempotencyKey: `qualify:${org.id}:${Date.now()}` });
    queued += 1;
  }
  if (actorId) await audit({ tenantId, actorId, action: "hunt.qualify", meta: { queued, skipped } });
  return { queued, skipped };
}

/** Новые карточки без квалификации: сначала активные сегменты и больше отзывов. */
export async function qualifyPending(tenantId: string, actorId: string | null, limit: number, confirmLarge = false) {
  const settings = await getSettings(tenantId);
  const candidates = await prisma.organization.findMany({
    where: { tenantId, isDemo: false, outreach: null, optOut: null },
    select: { id: true, category: true, categories: true },
    orderBy: [{ reviewCount: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 2000,
  });
  const active = new Set<string>(settings.hunt.activeSegments);
  const inContour = candidates
    .map((item) => ({ ...item, segment: detectSegment(item.category, item.categories) }))
    .filter((item) => item.segment == null || active.has(item.segment))
    .sort((a, b) => Number(b.segment != null) - Number(a.segment != null));
  const picked = inContour.slice(0, Math.max(1, Math.min(limit, 200)));
  if (!picked.length) return { queued: 0, skipped: 0, left: 0 };
  const result = await enqueueQualify(tenantId, actorId, picked.map((item) => item.id), confirmLarge);
  return { ...result, left: Math.max(0, inContour.length - picked.length) };
}

/** После поиска: все увиденные карточки без квалификации (не только созданные в этой попытке синхронизации). */
export async function autoQualifyNew(tenantId: string, organizationIds: string[]) {
  if (!organizationIds.length) return;
  const settings = await getSettings(tenantId);
  if (!settings.hunt.autoQualify || settings.hunt.autoQualifyMax <= 0) return;
  // Без AI карточка всё равно собирается по данным источника — конвейер не должен вставать из-за OpenRouter.
  const active = new Set<string>(settings.hunt.activeSegments);
  const orgs = await prisma.organization.findMany({
    where: { tenantId, id: { in: organizationIds }, isDemo: false, outreach: null, optOut: null },
    select: { id: true, category: true, categories: true, reviewCount: true },
    orderBy: { reviewCount: { sort: "desc", nulls: "last" } },
  });
  const ids = orgs
    .filter((item) => {
      const segment = detectSegment(item.category, item.categories);
      return segment == null || active.has(segment);
    })
    .slice(0, settings.hunt.autoQualifyMax)
    .map((item) => item.id);
  if (ids.length) await enqueueQualify(tenantId, null, ids, true);
}

export async function runQualify(organizationId: string, jobTenantId?: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { contacts: true } });
  if (!org || (jobTenantId && org.tenantId !== jobTenantId)) return;
  const tenantId = org.tenantId;
  const existing = await prisma.outreach.findUnique({ where: { organizationId } });
  if (existing && !OPEN.includes(existing.status)) return;
  const settings = await getSettings(tenantId);
  const facts = factsOf(org);
  if (isIncomplete(facts)) {
    // Парсер вернул пустую карточку — AI не вызываем, деньги не тратим. Её можно открыть по ссылке на источник.
    const data = { segment: detectSegment(org.category, org.categories), score: 0, priority: "D", card: Prisma.DbNull, factors: Prisma.DbNull, cardStatus: "incomplete", error: "Парсер не дочитал карточку: нет названия или контактов.", qualifiedAt: new Date() };
    if (existing) await prisma.outreach.update({ where: { id: existing.id }, data });
    else await prisma.outreach.create({ data: { tenantId, organizationId, ...data } });
    return;
  }
  let ai: QualifyResult | null = null;
  let model: string | null = null;
  let cost: number | null = null;
  let billed = false;
  let aiNote: string | null = null;

  if (await isReady(tenantId, "openrouter")) {
    const integration = await requireReady(tenantId, "openrouter", "Квалификация");
    await assertBudget(tenantId, settings.ai.maxCostPerAnalysisUsd);
    model = resolveTaskModel("analysis", settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL);
    const prompt = buildQualifyPrompt(facts);
    try {
      const result = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, model, system: prompt.system, user: prompt.user, schema: qualifyResultSchema, maxTokens: 1200 });
      ai = result.data;
      cost = typeof result.usage.cost === "number" ? result.usage.cost : null;
      billed = true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "ai_invalid_json") {
        billed = true; // вызов был, просто ответ не разобрался — фиксируем расход как неизвестный
        aiNote = "AI вернул неразборчивый ответ — карточка собрана только из данных источника.";
      } else if (error instanceof ApiError && ["network", "timeout"].includes(error.code)) {
        // Нет связи с OpenRouter (обычно умер прокси). Не стопорим конвейер: карточка по данным, стоп-правило действует.
        // Интеграция помечается ошибкой — следующие карточки не ждут таймаута, а в ленте видно предупреждение.
        await prisma.integration.updateMany({ where: { tenantId, provider: "openrouter" }, data: { status: "error", lastError: "Нет связи с OpenRouter: прокси не отвечает. Проверьте OPENROUTER_PROXY_URL и нажмите «Проверить» в интеграциях.", lastCheckedAt: new Date() } });
        aiNote = "AI недоступен (нет связи с OpenRouter) — карточка собрана по данным источника. Перезапустите скоринг, когда связь вернётся.";
        model = null;
      } else throw error;
    }
  } else {
    aiNote = "OpenRouter не подключён — карточка собрана только из данных источника.";
  }

  const card = buildCard(facts, ai);
  const scored = strategyScore(card, ai);
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
  const saved = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.outreach.update({ where: { id: existing.id }, data })
      : await tx.outreach.create({ data: { tenantId, organizationId, ...data } });
    await tx.leadScore.create({
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
    return row;
  });
  if (billed) await recordCost({ tenantId, provider: "openrouter", operation: "qualify", amountUsd: cost, organizationId, refType: "outreach", refId: saved.id });
  if (scored.priority === "A" || scored.priority === "B") await queueSheet(tenantId, "outreach", saved.id);
}

export async function markQualifyFailed(organizationId: string, message: string) {
  await prisma.outreach.updateMany({ where: { organizationId, cardStatus: "queued" }, data: { cardStatus: "failed", error: message.slice(0, 500) } });
}

/** Карточки, застрявшие в очереди: задача умерла, отменена или воркер падал. Через 20 минут без живой задачи — «failed», можно перезапустить. */
async function sweepStuck(tenantId: string) {
  const stale = await prisma.outreach.findMany({ where: { tenantId, cardStatus: "queued", updatedAt: { lt: new Date(Date.now() - 20 * 60 * 1000) } }, select: { organizationId: true }, take: 100 });
  for (const row of stale) {
    if (!(await hasLiveQualifyJob(tenantId, row.organizationId))) await markQualifyFailed(row.organizationId, "Квалификация не завершилась. Запустите ещё раз.");
  }
}

/* ───────────── Лента «Сегодня» ───────────── */

async function bounds(tenantId: string) {
  const settings = await getSettings(tenantId);
  return { ...dayBounds(settings.hunt.timezone), settings };
}

async function suppressedOrgIds(tenantId: string, rows: { organizationId: string; organization: { contacts?: { value: string }[] } }[]) {
  if (!rows.length) return new Set<string>();
  const values = rows.flatMap((row) => [`org:${row.organizationId}`, ...(row.organization.contacts ?? []).map((item) => item.value.toLowerCase())]);
  const hits = await prisma.suppressionEntry.findMany({ where: { tenantId, value: { in: values } }, select: { value: true } });
  const hit = new Set(hits.map((item) => item.value));
  return new Set(rows.filter((row) => hit.has(`org:${row.organizationId}`) || (row.organization.contacts ?? []).some((item) => hit.has(item.value.toLowerCase()))).map((row) => row.organizationId));
}

const listInclude = {
  organization: {
    select: { id: true, name: true, city: true, category: true, rating: true, reviewCount: true, website: true, sourceUrl: true, contacts: { select: { type: true, value: true } } },
  },
  project: { select: { id: true, stage: true } },
} as const;

type OutreachRow = Prisma.OutreachGetPayload<{ include: typeof listInclude }>;

/** Не показываем тех, кому писать нельзя: отказ, стоп-лист, стадия «Не связываться». */
const contactableOrg = { optOut: null, NOT: { lead: { stage: { key: "do_not_contact" } } } } satisfies Prisma.OrganizationWhereInput;

export async function today(tenantId: string, limit = 20) {
  await sweepStuck(tenantId);
  const { start, end, settings } = await bounds(tenantId);
  const now = new Date();
  const where: Prisma.OutreachWhereInput = {
    tenantId,
    cardStatus: "ready",
    priority: { in: ["A", "B"] },
    OR: [{ status: "new" }, { status: "snoozed", snoozeUntil: { lte: now } }],
    organization: contactableOrg,
  };
  const take = Number.isFinite(limit) ? Math.min(Math.max(1, limit), 50) : 20;
  const reviewWhere: Prisma.OutreachWhereInput = {
    tenantId,
    cardStatus: "no_fact",
    score: { gte: 40 },
    OR: [{ status: "new" }, { status: "snoozed", snoozeUntil: { lte: now } }],
    organization: contactableOrg,
  };
  const [rows, total, approved, followUps, queued, failed, sent, incomplete, reviewRows, reviewTotal] = await Promise.all([
    prisma.outreach.findMany({ where, include: listInclude, orderBy: [{ priority: "asc" }, { score: "desc" }], take }),
    prisma.outreach.count({ where }),
    prisma.outreach.count({ where: { tenantId, status: "approved", organization: contactableOrg } }),
    prisma.outreach.count({ where: { tenantId, status: { in: [...LIVE, "sent"] }, nextFollowUpAt: { lte: end }, organization: contactableOrg } }),
    prisma.outreach.count({ where: { tenantId, cardStatus: "queued" } }),
    prisma.outreach.count({ where: { tenantId, cardStatus: "failed" } }),
    sentCount(tenantId, start),
    prisma.outreach.count({ where: { tenantId, cardStatus: "incomplete" } }),
    prisma.outreach.findMany({ where: reviewWhere, include: listInclude, orderBy: { score: "desc" }, take: 30 }),
    prisma.outreach.count({ where: reviewWhere }),
  ]);
  const blocked = await suppressedOrgIds(tenantId, [...rows, ...reviewRows]);
  const ai = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId, provider: "openrouter" } }, select: { status: true, lastError: true } });
  const aiReady = await isReady(tenantId, "openrouter");
  return {
    items: rows.filter((row) => !blocked.has(row.organizationId)).map((row) => publicItem(row, end)),
    total,
    review: reviewRows.filter((row) => !blocked.has(row.organizationId)).map((row) => publicItem(row, end)),
    reviewTotal: Math.max(0, reviewTotal - reviewRows.filter((row) => blocked.has(row.organizationId)).length),
    approved,
    followUps,
    queued,
    failed,
    incomplete,
    ai: { ready: aiReady, reason: aiReady ? null : ai?.lastError ?? "OpenRouter не подключён — скоринг идёт только по данным источника." },
    sentToday: sent,
    dailyLimit: settings.hunt.dailyLimit,
    activeSegments: settings.hunt.activeSegments,
    timezone: settings.hunt.timezone,
  };
}

async function sentCount(tenantId: string, since: Date, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.activity.count({ where: { tenantId, type: "outreach.sent", createdAt: { gte: since } } });
}

function publicItem(row: OutreachRow, endOfToday: Date) {
  return {
    id: row.id,
    organization: { id: row.organization.id, name: row.organization.name, city: row.organization.city, category: row.organization.category, rating: row.organization.rating, reviewCount: row.organization.reviewCount, website: row.organization.website, sourceUrl: row.organization.sourceUrl },
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
    followUpDue: row.status === "sent" && Boolean(row.nextFollowUpAt && row.nextFollowUpAt <= endOfToday),
    actionDue: LIVE.includes(row.status) && Boolean(row.nextFollowUpAt && row.nextFollowUpAt <= endOfToday),
    repliedAt: row.repliedAt,
    channel: row.channel,
    error: row.error,
    projectId: row.project?.id ?? null,
    updatedAt: row.updatedAt,
  };
}

const ownedInclude = { organization: { include: { contacts: true, optOut: true, lead: { include: { stage: true } } } }, project: { select: { id: true } } } as const;

async function owned(tenantId: string, id: string) {
  const row = await prisma.outreach.findFirst({ where: { id, tenantId }, include: ownedInclude });
  if (!row) throw new ApiError(404, "Карточка не найдена", "not_found");
  return row;
}

async function contactBlock(row: Awaited<ReturnType<typeof owned>>): Promise<string | null> {
  if (row.organization.optOut) return "Организация отказалась от сообщений.";
  if (row.organization.lead?.stage.key === "do_not_contact") return "Стадия «Не связываться».";
  const values = [`org:${row.organizationId}`, ...row.organization.contacts.map((item) => item.value.toLowerCase())];
  const hit = await prisma.suppressionEntry.findFirst({ where: { tenantId: row.tenantId, value: { in: values } } });
  return hit ? "Контакт в стоп-листе." : null;
}

async function assertContactable(row: Awaited<ReturnType<typeof owned>>) {
  const reason = await contactBlock(row);
  if (reason) throw new ApiError(409, reason, "do_not_contact");
}

export const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "snooze", "undo"]),
  reason: z.string().trim().max(200).optional(),
  days: z.number().int().min(1).max(60).optional(),
});

/** Решение по карточке. Работает только пока не было первого сообщения — иначе можно было бы «отправить» второй раз. */
export async function decide(tenantId: string, actorId: string, id: string, input: z.infer<typeof decisionSchema>) {
  const row = await owned(tenantId, id);
  if (!OPEN.includes(row.status)) throw new ApiError(409, "Сообщение уже отправлено — решение по карточке не меняется.", "already_sent");
  let data: Prisma.OutreachUpdateManyMutationInput;
  if (input.action === "approve") {
    if (row.cardStatus !== "ready") throw new ApiError(409, "Без подтверждённых фактов карточку нельзя взять в работу.", "card_not_ready");
    await assertContactable(row);
    data = { status: "approved", snoozeUntil: null, rejectReason: null };
  } else if (input.action === "reject") {
    data = { status: "rejected", rejectReason: input.reason || "Без причины" };
  } else if (input.action === "snooze") {
    data = { status: "snoozed", snoozeUntil: new Date(Date.now() + (input.days ?? 3) * DAY) };
  } else {
    data = { status: "new", snoozeUntil: null, rejectReason: null };
  }
  const result = await prisma.outreach.updateMany({ where: { id, tenantId, status: { in: OPEN } }, data });
  if (!result.count) throw new ApiError(409, "Карточку уже обработали на другом устройстве.", "conflict");
  if (input.action === "approve") await moveLead(tenantId, row.organizationId, "ready_to_contact", actorId);
  if (input.action === "reject") await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.rejected", message: `Отклонено: ${input.reason || "без причины"}` });
  await queueSheet(tenantId, "outreach", id);
  return { ok: true };
}

/* ───────────── Питч и отправка ───────────── */

export async function getItem(tenantId: string, id: string) {
  const row = await owned(tenantId, id);
  const { end } = await bounds(tenantId);
  const card = row.card as unknown as ObservationCard | null;
  const draft = row.pitch || (card ? buildPitch(card) : "");
  const followUpDue = row.status === "sent" && Boolean(row.nextFollowUpAt && row.nextFollowUpAt <= end);
  const followUp = row.status === "sent" ? followUpText(row.followUpStep + 1) : null;
  const blocked = await contactBlock(row);
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
      stage: row.organization.lead?.stage.name ?? null,
    },
    blocked,
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
    followUpDue,
    actionDue: LIVE.includes(row.status) && Boolean(row.nextFollowUpAt && row.nextFollowUpAt <= end),
    error: row.error,
    pitch: draft,
    followUp,
    banned: bannedIn(draft),
    links: contactLinks(card?.contact ?? row.organization.contacts.map((item) => ({ kind: item.type, value: item.value })), followUp ?? draft),
    projectId: row.project?.id ?? null,
    lastChannel: row.channel,
  };
}

export const pitchSchema = z.object({ text: z.string().trim().min(10).max(2000) });

export async function savePitch(tenantId: string, id: string, text: string) {
  const row = await owned(tenantId, id);
  if (!OPEN.includes(row.status)) throw new ApiError(409, "Сообщение уже отправлено.", "already_sent");
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
    "Скелет из трёх блоков: 1) крючок-факт «Увидел, что …. Верно?» 2) диагноз — что из-за этого теряется 3) мягкий оффер «Набросал, как это разгрузить … Скинуть глянуть?».",
    "До 600 символов, на «вы», без ссылок, без эмодзи, без цены, без выдуманных цифр.",
    "Запрещено: «мы делаем сайты», «сделаем сайт», «AI-агенты», «автоматизация», «интересный проект».",
    "Используй только факты из карточки (money, chaos, observation). Верни JSON {\"text\": \"...\"}.",
  ].join(" ");
  const user = JSON.stringify({ organization: row.organization.name, city: row.organization.city, facts: { money: card.money, chaos: card.chaos, observation: card.observation }, draft });
  const result = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, model, system, user, schema: rewriteSchema, maxTokens: 700 });
  const cost = typeof result.usage.cost === "number" ? result.usage.cost : null;
  await recordCost({ tenantId, provider: "openrouter", operation: "pitch", amountUsd: cost, organizationId: row.organizationId, refType: "outreach", refId: id });
  const text = result.data.text.trim();
  const banned = bannedIn(text);
  return { text: banned.length ? draft : text, banned, fallback: banned.length > 0 };
}

export const CHANNELS = ["telegram", "whatsapp", "vk", "email", "phone", "instagram", "avito", "other"] as const;

export const sentSchema = z.object({
  channel: z.enum(CHANNELS),
  text: z.string().trim().max(2000).optional(),
  force: z.boolean().optional(),
});

/** Человек отправил первое сообщение сам. Атомарно: лимит дня и смена статуса под одной блокировкой пространства. */
export async function markSent(tenantId: string, actorId: string, role: string, id: string, input: z.infer<typeof sentSchema>) {
  const row = await owned(tenantId, id);
  if (!["approved", "new", "snoozed"].includes(row.status)) throw new ApiError(409, "Первое сообщение уже отмечено.", "already_sent");
  if (row.cardStatus !== "ready") throw new ApiError(409, "Без подтверждённых фактов писать нельзя.", "card_not_ready");
  await assertContactable(row);
  const text = (input.text ?? row.pitch ?? "").trim();
  const banned = bannedIn(text);
  if (banned.length) throw new ApiError(422, `Уберите фразы: ${banned.join(", ")}`, "banned_phrase");
  if (input.force && !["OWNER", "ADMIN"].includes(role)) throw new ApiError(403, "Превысить дневной лимит может только владелец или администратор.", "forbidden");
  const { start, settings } = await bounds(tenantId);
  const sentAt = new Date();
  const count = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hunt-sent:${tenantId}`}))`;
    const already = await sentCount(tenantId, start, tx);
    if (already >= settings.hunt.dailyLimit && !input.force) {
      throw new ApiError(409, `Сегодня уже ${already} из ${settings.hunt.dailyLimit} новых касаний. Лимит защищает аккаунт от блокировки.`, "daily_limit");
    }
    const updated = await tx.outreach.updateMany({
      where: { id, tenantId, status: { in: ["approved", "new", "snoozed"] } },
      data: { status: "sent", sentAt, channel: input.channel, pitch: text || row.pitch, followUpStep: 0, nextFollowUpAt: new Date(sentAt.getTime() + FOLLOW_UP_DAYS[0] * DAY) },
    });
    if (!updated.count) throw new ApiError(409, "Отправку уже отметили на другом устройстве.", "already_sent");
    await tx.activity.create({ data: { tenantId, organizationId: row.organizationId, actorId, type: "outreach.sent", message: `Первое сообщение отправлено вручную (${input.channel})`, meta: { text: text.slice(0, 2000), channel: input.channel } } });
    return already + 1;
  });
  await moveLead(tenantId, row.organizationId, "contacted", actorId);
  await queueSheet(tenantId, "outreach", id);
  return { ok: true, sentToday: count, dailyLimit: settings.hunt.dailyLimit };
}

export async function followUpDone(tenantId: string, actorId: string, id: string, channel: string) {
  const row = await owned(tenantId, id);
  if (row.status !== "sent" || !row.sentAt) throw new ApiError(409, "Напоминание возможно только после первого сообщения без ответа.", "not_sent");
  await assertContactable(row);
  const { end } = await bounds(tenantId);
  if (!row.nextFollowUpAt || row.nextFollowUpAt > end) throw new ApiError(409, "Напоминать ещё рано.", "not_due");
  const step = row.followUpStep + 1;
  const next = nextFollowUpAt(row.sentAt, step, new Date());
  const updated = await prisma.outreach.updateMany({
    where: { id, tenantId, status: "sent", followUpStep: row.followUpStep },
    data: { followUpStep: step, nextFollowUpAt: next, status: next ? "sent" : "sleeping" },
  });
  if (!updated.count) throw new ApiError(409, "Напоминание уже отметили.", "conflict");
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.followup", message: `Напоминание ${step} отправлено вручную (${channel})` });
  await queueSheet(tenantId, "outreach", id);
  return { ok: true, step, next };
}

export const STATUS_FLOW: Record<string, { label: string; stage: string | null; from: string[] }> = {
  replied: { label: "Ответил", stage: "replied", from: ["sent", "sleeping", "lost"] },
  // §7 и §12.6: демо — после ответа «интересно», до созвона.
  demo: { label: "Демо показано", stage: "demo_ready", from: ["replied"] },
  call: { label: "Созвон", stage: "meeting", from: ["replied", "demo", "estimate"] },
  // §3: «не отправлять смет без созвона» — смета только после созвона.
  estimate: { label: "Смета", stage: "proposal", from: ["call"] },
  won: { label: "Сделка", stage: "won", from: ["call", "estimate"] },
  lost: { label: "Отказ", stage: "lost", from: ["sent", "replied", "demo", "call", "estimate", "sleeping"] },
  sleeping: { label: "Спящий", stage: null, from: ["sent"] },
  optout: { label: "Просит не писать", stage: "do_not_contact", from: ["sent", "replied", "demo", "call", "estimate", "sleeping", "lost", "approved", "new", "snoozed"] },
};

export const statusSchema = z.object({ status: z.enum(["replied", "demo", "call", "estimate", "won", "lost", "sleeping", "optout"]), note: z.string().trim().max(500).optional() });

export async function setStatus(tenantId: string, actorId: string, id: string, input: z.infer<typeof statusSchema>) {
  const row = await owned(tenantId, id);
  const flow = STATUS_FLOW[input.status];
  if (!flow.from.includes(row.status)) throw new ApiError(409, `Из статуса «${row.status}» нельзя перейти в «${flow.label}».`, "bad_transition");
  // Проект создаётся до смены статуса: если создание упадёт, статус не изменится и повтор сработает. Создание идемпотентно.
  // Этап проекта следует за лидом: «Смета» → смета, «Сделка» → договор и аванс (§3, шаг 12 стратегии).
  let projectId: string | null = row.project?.id ?? null;
  if (input.status === "estimate" || input.status === "won") {
    const stage = input.status === "won" ? "prepaid" : "estimate";
    const { createProject, updateProject } = await import("./projects");
    if (!projectId) {
      const created = await createProject(tenantId, actorId, { outreachId: id }, "hunt", stage);
      projectId = created.project.id;
    } else {
      const current = await prisma.project.findFirst({ where: { id: projectId, tenantId }, select: { stage: true } });
      const order = ["brief", "estimate", "prepaid"];
      if (current && order.indexOf(current.stage) >= 0 && order.indexOf(current.stage) < order.indexOf(stage)) await updateProject(tenantId, actorId, projectId, { stage });
    }
  }
  const nextStatus = input.status === "optout" ? "lost" : input.status;
  const updated = await prisma.outreach.updateMany({
    where: { id, tenantId, status: row.status },
    data: {
      status: nextStatus,
      nextFollowUpAt: NEXT_STEP_HOURS[nextStatus] ? new Date(Date.now() + NEXT_STEP_HOURS[nextStatus] * 60 * 60 * 1000) : null,
      repliedAt: ["replied", "demo", "call", "estimate", "won"].includes(input.status) ? (row.repliedAt ?? new Date()) : row.repliedAt,
      rejectReason: input.status === "optout" ? "Просит не писать" : row.rejectReason,
    },
  });
  if (!updated.count) throw new ApiError(409, "Статус уже изменили на другом устройстве.", "conflict");
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: `outreach.${input.status}`, message: `${flow.label}${input.note ? `: ${input.note}` : ""}` });
  if (flow.stage) await moveLead(tenantId, row.organizationId, flow.stage, actorId);
  await queueSheet(tenantId, "outreach", id);
  return { ok: true, projectId };
}

/* ───────────── Диалоги и цифры ───────────── */

export async function dialogs(tenantId: string) {
  const { end } = await bounds(tenantId);
  const [due, active, waiting, approved, sleeping, failed] = await Promise.all([
    prisma.outreach.findMany({ where: { tenantId, status: { in: ["sent", ...LIVE] }, nextFollowUpAt: { lte: end }, organization: contactableOrg }, include: listInclude, orderBy: { nextFollowUpAt: "asc" }, take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: { in: LIVE } }, include: listInclude, orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }], take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: "sent", OR: [{ nextFollowUpAt: { gt: end } }, { nextFollowUpAt: null }] }, include: listInclude, orderBy: { sentAt: "desc" }, take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: "approved", organization: contactableOrg }, include: listInclude, orderBy: [{ priority: "asc" }, { score: "desc" }], take: 50 }),
    prisma.outreach.findMany({ where: { tenantId, status: { in: ["sleeping", "won", "lost"] } }, include: listInclude, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.outreach.count({ where: { tenantId, cardStatus: "failed" } }),
  ]);
  const map = (rows: OutreachRow[]) => rows.map((row) => publicItem(row, end));
  return { due: map(due), active: map(active), waiting: map(waiting), approved: map(approved), closed: map(sleeping), failed };
}

export async function retryFailed(tenantId: string, actorId: string) {
  const rows = await prisma.outreach.findMany({ where: { tenantId, cardStatus: "failed" }, select: { organizationId: true }, take: 200 });
  return enqueueQualify(tenantId, actorId, rows.map((row) => row.organizationId), true);
}

export async function stats(tenantId: string, days = 7) {
  const since = new Date(Date.now() - days * DAY);
  // Воронка по истории действий, а не по текущему статусу: «созвон → отказ» всё равно остаётся созвоном (§9).
  const reached = async (type: string) => (await prisma.activity.findMany({ where: { tenantId, type, createdAt: { gte: since } }, distinct: ["organizationId"], select: { organizationId: true } })).length;
  const [touches, replies, calls, estimates, won, totalTouches, qualified, passed, bySegment, projects] = await Promise.all([
    prisma.activity.count({ where: { tenantId, type: "outreach.sent", createdAt: { gte: since } } }),
    reached("outreach.replied"),
    reached("outreach.call"),
    reached("outreach.estimate"),
    reached("outreach.won"),
    prisma.outreach.count({ where: { tenantId, sentAt: { not: null } } }),
    prisma.outreach.count({ where: { tenantId, qualifiedAt: { gte: since } } }),
    prisma.outreach.count({ where: { tenantId, qualifiedAt: { gte: since }, score: { gte: QUALIFY_THRESHOLD }, cardStatus: "ready" } }),
    prisma.outreach.groupBy({ by: ["segment"], where: { tenantId, sentAt: { gte: since } }, _count: { _all: true } }),
    prisma.project.aggregate({ where: { tenantId, stage: { notIn: ["cancelled"] } }, _count: { _all: true }, _sum: { amount: true } }),
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
    projects: { count: projects._count._all, amount: projects._sum.amount ?? 0 },
    bySegment: bySegment.map((item) => ({ segment: item.segment, label: segmentInfo(item.segment)?.label ?? "Без сегмента", count: item._count._all })),
    advice,
  };
}

export const factSchema = z.object({ kind: z.enum(["money", "chaos"]), text: z.string().trim().min(3).max(200) });

/** Человек проверил карточку и подтвердил факт (§3, шаг 5). Балл пересчитывается, карточка может стать A/B. */
export async function addFact(tenantId: string, actorId: string, id: string, input: z.infer<typeof factSchema>) {
  const row = await owned(tenantId, id);
  if (!OPEN.includes(row.status)) throw new ApiError(409, "По карточке уже идёт диалог.", "already_sent");
  const card = row.card as unknown as ObservationCard | null;
  if (!card) throw new ApiError(409, "Карточка ещё не собрана — дождитесь скоринга.", "card_missing");
  const next = addManualFact(card, input.kind, input.text);
  const scored = strategyScore(next, flagsFromFactors(row.factors as unknown as StrategyFactor[] | null));
  const updated = await prisma.outreach.updateMany({
    where: { id, tenantId, status: { in: OPEN } },
    data: {
      card: { ...next, promptVersion: QUALIFY_PROMPT_VERSION } as unknown as Prisma.InputJsonValue,
      factors: scored.factors as unknown as Prisma.InputJsonValue,
      score: scored.score,
      priority: scored.priority,
      cardStatus: scored.ready ? "ready" : "no_fact",
    },
  });
  if (!updated.count) throw new ApiError(409, "Карточку уже изменили на другом устройстве.", "conflict");
  await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.fact", message: `Подтверждён факт (${input.kind === "money" ? "деньги" : "хаос"}): ${input.text}` });
  await queueSheet(tenantId, "outreach", id);
  return { ok: true, score: scored.score, priority: scored.priority, ready: scored.ready };
}

/** Следующая карточка для работы: сначала взятые в работу, потом новые A/B. Чтобы после «Отправил» не возвращаться в список. */
export async function nextItem(tenantId: string, excludeId?: string | null) {
  const now = new Date();
  const base = { tenantId, organization: contactableOrg, ...(excludeId ? { id: { not: excludeId } } : {}) } satisfies Prisma.OutreachWhereInput;
  const pick = async (where: Prisma.OutreachWhereInput) => {
    const rows = await prisma.outreach.findMany({ where, orderBy: [{ priority: "asc" }, { score: "desc" }], take: 10, select: { id: true, organizationId: true, organization: { select: { contacts: { select: { value: true } } } } } });
    const blocked = await suppressedOrgIds(tenantId, rows);
    return rows.find((row) => !blocked.has(row.organizationId)) ?? null;
  };
  const approved = await pick({ ...base, status: "approved" });
  if (approved) return { id: approved.id, kind: "write" as const };
  const fresh = await pick({ ...base, cardStatus: "ready", priority: { in: ["A", "B"] }, OR: [{ status: "new" }, { status: "snoozed", snoozeUntil: { lte: now } }] });
  return fresh ? { id: fresh.id, kind: "review" as const } : null;
}

/** Последние поиски с воронкой: сколько пришло, сколько неполных, без фактов, готовых к ленте. */
export async function searches(tenantId: string) {
  const tasks = await prisma.parserTask.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 });
  return Promise.all(tasks.map(async (task) => {
    const summary = (task.resultSummary ?? {}) as { orgIds?: string[] };
    const ids = Array.isArray(summary.orgIds) ? summary.orgIds : [];
    const rows = ids.length ? await prisma.outreach.groupBy({ by: ["cardStatus", "priority"], where: { tenantId, organizationId: { in: ids } }, _count: { _all: true } }) : [];
    const count = (fn: (row: (typeof rows)[number]) => boolean) => rows.filter(fn).reduce((sum, row) => sum + row._count._all, 0);
    const input = (task.input ?? {}) as { city?: string; category?: string; maxResults?: number };
    return {
      id: task.id,
      city: input.city ?? "",
      category: input.category ?? "",
      requested: input.maxResults ?? null,
      status: task.status,
      syncedAt: task.syncedAt,
      createdAt: task.createdAt,
      error: task.error,
      received: task.organizationCount,
      funnel: ids.length ? {
        incomplete: count((row) => row.cardStatus === "incomplete"),
        noFact: count((row) => row.cardStatus === "no_fact"),
        review: count((row) => row.cardStatus === "no_fact" && row.priority === "C"),
        ready: count((row) => row.cardStatus === "ready" && ["A", "B"].includes(row.priority)),
        queued: count((row) => row.cardStatus === "queued"),
      } : null,
    };
  }));
}
