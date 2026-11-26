import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError, RetryableError } from "../errors";
import { resolveTaskModel } from "../domain/models";
import { completeJson } from "../integrations/openrouter";
import { isReady, requireReady } from "../integrations/config";
import { messengerReader, type MessengerReader, type TgMessage } from "../integrations/messengers";
import { enqueueJob } from "../jobs/queue";
import { logEvent } from "../log";
import { activity, audit, getSettings, recordCost } from "./common";
import {
  authorChatLink,
  buildRadarPrompt,
  finalScore,
  keywordFilter,
  keywordOnlyResult,
  messageLink,
  parseChatRef,
  parseWordList,
  radarResultSchema,
  readablePeer,
  rejectPenalty,
  type RadarResult,
} from "../domain/radar";
import type { ObservationCard } from "../domain/qualify";
import { deliverFinding, disconnectBot, maybeWeeklyReport } from "./radar-bot";

/**
 * Радар: читает НОВЫЕ сообщения открытых чатов (без вступления), фильтрует по словам, классифицирует моделью
 * и складывает находки. Никому ничего не отправляет: ответ автору пишет человек сам.
 * Опрос — одна самоперепланирующаяся задача `radar.poll` на проект (ключ `radar:<projectId>`).
 */

const MAX_AI_PER_RUN = 15;
/** Старее этого не берём никогда: радар — про свежие запросы. */
const FIRST_RUN_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const DEFAULT_READS_PER_MINUTE = 12;

/* ───────────── Лимит чтений (общий аккаунт Telegram) ───────────── */

const reads = new Map<string, number[]>();

/** Свободно ли ещё одно чтение в эту минуту. Обработчик задач один, поэтому счётчика в памяти достаточно. */
function takeRead(tenantId: string, perMinute: number) {
  const now = Date.now();
  const list = (reads.get(tenantId) ?? []).filter((at) => now - at < 60_000);
  if (list.length >= perMinute) {
    reads.set(tenantId, list);
    return Math.max(1000, 60_000 - (now - list[0]));
  }
  list.push(now);
  reads.set(tenantId, list);
  return 0;
}

export async function radarConfig(tenantId: string) {
  const row = await prisma.radarConfig.findUnique({ where: { tenantId } });
  return { readsPerMinute: row?.readsPerMinute ?? DEFAULT_READS_PER_MINUTE };
}

export const radarConfigSchema = z.object({ readsPerMinute: z.number().int().min(1).max(30) });

export async function saveRadarConfig(tenantId: string, actorId: string, input: z.infer<typeof radarConfigSchema>) {
  await prisma.radarConfig.upsert({ where: { tenantId }, update: input, create: { tenantId, ...input } });
  await audit({ tenantId, actorId, action: "radar.config", meta: input });
  return radarConfig(tenantId);
}

/* ───────────── Проекты ───────────── */

const wordsField = z.union([z.string().max(5000), z.array(z.string().max(80)).max(100)]).transform((value) => parseWordList(value));

export const radarProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["own", "client"]).default("own"),
  target: z.string().trim().max(600).optional().nullable(),
  keywords: wordsField.default([]),
  minusWords: wordsField.default([]),
  pollMinutes: z.number().int().min(10).max(240).default(15),
  minScore: z.number().int().min(0).max(100).default(40),
  active: z.boolean().default(true),
});
export const radarProjectPatchSchema = radarProjectSchema.partial();

const projectSelect = {
  id: true, name: true, kind: true, target: true, keywords: true, minusWords: true, active: true, pollMinutes: true, minScore: true,
  botUsername: true, botChatId: true, botChatTitle: true, bindExpiresAt: true, botTokenEnc: true, lastPollAt: true, lastReportAt: true, createdAt: true,
  sources: { orderBy: { createdAt: "asc" }, select: { id: true, username: true, title: true, type: true, members: true, active: true, lastPolledAt: true, lastError: true, readCount: true, matchCount: true } },
} satisfies Prisma.RadarProjectSelect;

function publicProject(row: Prisma.RadarProjectGetPayload<{ select: typeof projectSelect }>, counts: Map<string, number>) {
  const { botTokenEnc, botChatId, bindExpiresAt, ...rest } = row;
  return {
    ...rest,
    bot: { connected: Boolean(botTokenEnc), username: row.botUsername, linked: Boolean(botChatId), chatTitle: row.botChatTitle, pending: Boolean(bindExpiresAt && bindExpiresAt > new Date()) },
    fresh: counts.get(row.id) ?? 0,
  };
}

async function ownedProject(tenantId: string, id: string) {
  const row = await prisma.radarProject.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(404, "Проект радара не найден", "not_found");
  return row;
}

export async function radarOverview(tenantId: string) {
  const [projects, config, grouped, ai, parser] = await Promise.all([
    prisma.radarProject.findMany({ where: { tenantId }, select: projectSelect, orderBy: { createdAt: "asc" } }),
    radarConfig(tenantId),
    prisma.radarFinding.groupBy({ by: ["projectId"], where: { tenantId, status: "new" }, _count: { _all: true } }),
    isReady(tenantId, "openrouter").catch(() => false),
    isReady(tenantId, "parser").catch(() => false),
  ]);
  // Самовосстановление: у каждого активного проекта должна жить задача опроса.
  for (const project of projects) if (project.active && project.sources.some((item) => item.active)) await ensurePollJob(tenantId, project.id);
  const counts = new Map(grouped.map((item) => [item.projectId, item._count._all]));
  return { projects: projects.map((item) => publicProject(item, counts)), config, ready: { ai, telegram: parser } };
}

export async function createRadarProject(tenantId: string, actorId: string, input: z.infer<typeof radarProjectSchema>) {
  const count = await prisma.radarProject.count({ where: { tenantId } });
  if (count >= 20) throw new ApiError(409, "Не больше 20 проектов радара.", "radar_limit");
  const row = await prisma.radarProject.create({ data: { tenantId, ...input, target: input.target || null } });
  await audit({ tenantId, actorId, action: "radar.project_create", entityType: "radar", entityId: row.id });
  return { id: row.id };
}

export async function updateRadarProject(tenantId: string, actorId: string, id: string, input: z.infer<typeof radarProjectPatchSchema>) {
  await ownedProject(tenantId, id);
  const data: Prisma.RadarProjectUpdateInput = { ...input };
  if (input.target !== undefined) data.target = input.target || null;
  await prisma.radarProject.update({ where: { id }, data });
  await audit({ tenantId, actorId, action: "radar.project_update", entityType: "radar", entityId: id });
  if (input.active !== false) await ensurePollJob(tenantId, id);
  return { ok: true };
}

export async function deleteRadarProject(tenantId: string, actorId: string, id: string) {
  const row = await ownedProject(tenantId, id);
  if (row.botTokenEnc) {
    await disconnectBot(tenantId, actorId, id).catch(() => undefined);
  }
  await prisma.radarProject.delete({ where: { id } });
  await prisma.job.updateMany({ where: { tenantId, idempotencyKey: `radar:${id}`, status: { in: ["queued", "running"] } }, data: { cancelRequested: true } });
  await audit({ tenantId, actorId, action: "radar.project_delete", entityType: "radar", entityId: id });
  return { ok: true };
}

/* ───────────── Источники ───────────── */

export const radarSourceSchema = z.object({ ref: z.string().trim().min(2).max(200) });

/** Добавить открытый чат/канал: проверяем через resolve, закрытые, людей и ботов отклоняем. Вступления нет. */
export async function addRadarSource(tenantId: string, actorId: string, projectId: string, ref: string) {
  await ownedProject(tenantId, projectId);
  const username = parseChatRef(ref);
  if (!username) throw new ApiError(400, "Нужна ссылка на открытый чат или канал: @username или t.me/username. Приглашения t.me/+… — закрытые, их радар не читает.", "radar_bad_ref");
  const exists = await prisma.radarSource.findUnique({ where: { projectId_username: { projectId, username } } });
  if (exists) throw new ApiError(409, "Этот чат уже в проекте.", "radar_source_exists");
  const total = await prisma.radarSource.count({ where: { projectId } });
  if (total >= 50) throw new ApiError(409, "Не больше 50 чатов в одном проекте.", "radar_limit");
  const reader = await messengerReader(tenantId);
  const peer = await reader.resolve(username);
  if (!readablePeer(peer)) throw new ApiError(422, peer.type === "user" || peer.type === "bot" ? "Это человек или бот, а не чат. Радар читает только открытые группы и каналы." : "Чат закрытый или без публичного @username — радар его не читает.", "radar_closed");
  // Проверка чтения без вступления: если история не отдаётся — чат фактически закрыт.
  const probe = await reader.history(username, { limit: 1 });
  const row = await prisma.radarSource.create({
    data: { tenantId, projectId, username: peer.username ?? username, title: peer.title.slice(0, 200), type: peer.type, members: peer.members ?? null, cursor: probe.messages[0]?.id ? Math.max(0, probe.messages[0].id - 50) : null },
  });
  await audit({ tenantId, actorId, action: "radar.source_add", entityType: "radar", entityId: row.id, meta: { username: row.username } });
  await ensurePollJob(tenantId, projectId, true);
  return { id: row.id, title: row.title, username: row.username, members: row.members };
}

export async function patchRadarSource(tenantId: string, id: string, active: boolean) {
  const row = await prisma.radarSource.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(404, "Чат не найден", "not_found");
  await prisma.radarSource.update({ where: { id }, data: { active, lastError: active ? null : row.lastError } });
  if (active) await ensurePollJob(tenantId, row.projectId);
  return { ok: true };
}

export async function deleteRadarSource(tenantId: string, actorId: string, id: string) {
  const row = await prisma.radarSource.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(404, "Чат не найден", "not_found");
  await prisma.radarSource.delete({ where: { id } });
  await audit({ tenantId, actorId, action: "radar.source_delete", entityType: "radar", entityId: id });
  return { ok: true };
}

/** Найти открытые чаты по словам (глобальный поиск Telegram) — только группы и каналы с @username. */
export async function searchRadarChats(tenantId: string, query: string) {
  const reader = await messengerReader(tenantId);
  const found = await reader.search(query.slice(0, 80), 20);
  return found.filter(readablePeer).map((peer) => ({ username: peer.username, title: peer.title, type: peer.type, members: peer.members ?? null }));
}

/* ───────────── Опрос ───────────── */

export async function ensurePollJob(tenantId: string, projectId: string, now = false) {
  const job = await enqueueJob({ tenantId, type: "radar.poll", payload: { projectId }, idempotencyKey: `radar:${projectId}`, maxAttempts: 8 });
  if (now && job.status === "queued" && job.runAt > new Date()) await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
  return job;
}

export async function pollNow(tenantId: string, projectId: string) {
  await ownedProject(tenantId, projectId);
  await prisma.radarSource.updateMany({ where: { projectId, active: true }, data: { lastPolledAt: null } });
  await ensurePollJob(tenantId, projectId, true);
  return { queued: true };
}

type Classifier = (input: { text: string; chatTitle: string; matched: string[] }) => Promise<{ result: RadarResult; model: string | null }>;

async function classifier(tenantId: string, project: { name: string; kind: string; target: string | null; keywords: string[] }, rejected: string[]): Promise<Classifier> {
  const ready = await isReady(tenantId, "openrouter").catch(() => false);
  if (!ready) return async ({ text, matched }) => ({ result: keywordOnlyResult(text, matched), model: null });
  const integration = await requireReady(tenantId, "openrouter", "Радар");
  const settings = await getSettings(tenantId);
  const model = resolveTaskModel("analysis", settings.ai.qualifyModel || process.env.AI_DEFAULT_MODEL);
  return async ({ text, chatTitle }) => {
    const prompt = buildRadarPrompt({ projectName: project.name, kind: project.kind, target: project.target, keywords: project.keywords, chatTitle, text, rejected });
    const out = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, secrets: integration.secrets, model, system: prompt.system, user: prompt.user, schema: radarResultSchema, maxTokens: 500 });
    await recordCost({ tenantId, provider: "openrouter", operation: "radar.classify", amountUsd: typeof out.usage.cost === "number" ? out.usage.cost : null, refType: "radar" });
    return { result: out.data as RadarResult, model };
  };
}

function authorOf(message: TgMessage) {
  const from = message.from;
  if (!from || from.type === "channel") return { username: null, name: from?.title ?? null };
  return { username: from.username ?? null, name: from.title || null };
}

/**
 * Один проход по проекту. Возвращает, через сколько мс запустить следующий.
 * FLOOD_WAIT / 429 → ждём, сколько просит Telegram (RetryableError из клиента), остальные чаты — в следующий раз.
 */
export async function runRadarPoll(projectId: string, jobTenantId: string, deps: { reader?: MessengerReader } = {}): Promise<number | null> {
  const project = await prisma.radarProject.findFirst({ where: { id: projectId, tenantId: jobTenantId }, include: { sources: { where: { active: true } } } });
  if (!project || !project.active || !project.sources.length) return null;
  const tenantId = project.tenantId;
  const intervalMs = project.pollMinutes * 60_000;
  const { readsPerMinute } = await radarConfig(tenantId);
  const due = project.sources
    .filter((item) => !item.lastPolledAt || Date.now() - item.lastPolledAt.getTime() >= intervalMs - 30_000)
    .sort((a, b) => (a.lastPolledAt?.getTime() ?? 0) - (b.lastPolledAt?.getTime() ?? 0));
  const reader = deps.reader ?? (await messengerReader(tenantId));
  const rejected = (await prisma.radarFeedback.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 40, select: { text: true } })).map((item) => item.text);
  const classify = await classifier(tenantId, project, rejected);
  let aiCalls = 0;
  let created = 0;

  for (const source of due) {
    const wait = takeRead(tenantId, readsPerMinute);
    if (wait) return wait; // лимит чтений в минуту — продолжим, когда освободится
    let history;
    try {
      history = await reader.history(source.username, { limit: 50 });
    } catch (error) {
      if (error instanceof RetryableError) {
        await prisma.radarSource.update({ where: { id: source.id }, data: { lastError: error.message.slice(0, 300) } });
        logEvent("radar.flood_wait", { tenant: tenantId, project: projectId, delayMs: error.delayMs }, "warn");
        return Math.max(error.delayMs, 30_000);
      }
      const message = error instanceof Error ? error.message : "Не удалось прочитать чат";
      const closed = error instanceof ApiError && [400, 403, 404].includes(error.status);
      await prisma.radarSource.update({ where: { id: source.id }, data: { lastError: message.slice(0, 300), lastPolledAt: new Date(), ...(closed ? { active: false } : {}) } });
      continue;
    }
    const lookback = Date.now() - FIRST_RUN_LOOKBACK_MS;
    const fresh = history.messages
      .filter((item) => (source.cursor == null || item.id > source.cursor) && Date.parse(item.date) >= lookback)
      .filter((item) => item.text && item.text.trim().length >= 12)
      .sort((a, b) => a.id - b.id);
    const maxId = history.messages.reduce((max, item) => Math.max(max, item.id), source.cursor ?? 0);
    let matchCount = 0;
    let cursor = source.cursor ?? 0;
    for (const message of fresh) {
      const verdict = keywordFilter(message.text, project.keywords, project.minusWords);
      if (!verdict.pass) {
        cursor = Math.max(cursor, message.id);
        continue;
      }
      if (aiCalls >= MAX_AI_PER_RUN) break; // остальное — в следующий проход, курсор не двигаем
      matchCount += 1;
      aiCalls += 1;
      let classified;
      try {
        classified = await classify({ text: message.text, chatTitle: source.title, matched: verdict.matched });
      } catch (error) {
        if (error instanceof RetryableError) {
          await prisma.radarSource.update({ where: { id: source.id }, data: { cursor } });
          return Math.max(error.delayMs, 30_000);
        }
        logEvent("radar.classify_failed", { tenant: tenantId, project: projectId, error: error instanceof Error ? error.message.slice(0, 200) : "?" }, "warn");
        classified = { result: keywordOnlyResult(message.text, verdict.matched), model: null };
      }
      cursor = Math.max(cursor, message.id);
      const { result } = classified;
      const penalty = rejectPenalty(message.text, rejected);
      const score = finalScore(result.score, penalty);
      // Предложения, реклама и слабые совпадения не засоряют ленту.
      if (result.intent === "offer" || result.intent === "ad" || score < Math.min(20, project.minScore)) continue;
      const author = authorOf(message);
      try {
        const finding = await prisma.radarFinding.create({
          data: {
            tenantId, projectId, sourceId: source.id, messageId: message.id, chatUsername: source.username, chatTitle: source.title,
            authorUsername: author.username, authorName: author.name, text: message.text.slice(0, 4000), link: message.link || messageLink(source.username, message.id),
            postedAt: new Date(message.date), summary: result.summary, intent: result.intent, city: result.city, district: result.district, deadline: result.deadline, budget: result.budget,
            score, penalty, reply: result.reply, matched: verdict.matched, model: classified.model,
          },
        });
        created += 1;
        if (project.kind === "client" && score >= project.minScore) await deliverFinding(finding.id).catch(() => undefined);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    // Всё, что прочитано и не дошло до модели из-за лимита, остаётся новее курсора.
    const finished = aiCalls < MAX_AI_PER_RUN;
    await prisma.radarSource.update({
      where: { id: source.id },
      data: { cursor: finished ? Math.max(cursor, maxId) : cursor, lastPolledAt: finished ? new Date() : source.lastPolledAt, lastError: null, readCount: { increment: 1 }, matchCount: { increment: matchCount } },
    });
    if (!finished) break;
  }
  await prisma.radarProject.update({ where: { id: projectId }, data: { lastPollAt: new Date() } });
  if (created) logEvent("radar.findings", { tenant: tenantId, project: projectId, created });
  if (project.kind === "client") {
    // «Позже» в боте: через сутки запрос приходит заказчику ещё раз.
    const due = await prisma.radarFinding.findMany({ where: { projectId, status: "later", snoozeUntil: { lte: new Date() } }, select: { id: true }, take: 10 });
    for (const item of due) {
      await prisma.radarFinding.update({ where: { id: item.id }, data: { status: "new", snoozeUntil: null, botMessageId: null } });
      await deliverFinding(item.id).catch(() => undefined);
    }
    await maybeWeeklyReport(projectId).catch(() => undefined);
  }
  // Следующий проход: когда подойдёт срок ближайшего чата (не чаще раза в минуту).
  const sources = await prisma.radarSource.findMany({ where: { projectId, active: true }, select: { lastPolledAt: true } });
  if (!sources.length) return null;
  const next = Math.min(...sources.map((item) => (item.lastPolledAt ? item.lastPolledAt.getTime() + intervalMs - Date.now() : 0)));
  return Math.max(60_000, next);
}

/* ───────────── Лента и действия ───────────── */

export const radarFeedQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(["new", "later", "taken", "rejected", "all"]).default("new"),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
});

export async function radarFeed(tenantId: string, query: z.infer<typeof radarFeedQuerySchema>) {
  const now = new Date();
  const where: Prisma.RadarFindingWhereInput = { tenantId, ...(query.projectId ? { projectId: query.projectId } : {}) };
  if (query.status === "new") where.OR = [{ status: "new" }, { status: "later", snoozeUntil: { lte: now } }];
  else if (query.status !== "all") where.status = query.status;
  if (query.minScore != null) where.score = { gte: query.minScore };
  const rows = await prisma.radarFinding.findMany({
    where,
    orderBy: query.status === "new" ? [{ score: "desc" }, { postedAt: "desc" }] : [{ updatedAt: "desc" }],
    take: 100,
    include: { project: { select: { name: true, kind: true, minScore: true } } },
  });
  const outreach = await prisma.outreach.findMany({ where: { tenantId, organizationId: { in: rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)) } }, select: { id: true, organizationId: true } });
  const itemByOrg = new Map(outreach.map((item) => [item.organizationId, item.id]));
  return rows
    .filter((row) => query.status !== "new" || query.minScore != null || row.score >= Math.min(row.project.minScore, 100))
    .map((row) => ({
      id: row.id, projectId: row.projectId, projectName: row.project.name, projectKind: row.project.kind, chatTitle: row.chatTitle, chatUsername: row.chatUsername,
      authorUsername: row.authorUsername, authorName: row.authorName, authorLink: authorChatLink(row.authorUsername), text: row.text, link: row.link, postedAt: row.postedAt,
      summary: row.summary, intent: row.intent, city: row.city, district: row.district, deadline: row.deadline, budget: row.budget, score: row.score, penalty: row.penalty,
      reply: row.reply, matched: row.matched, status: row.status, snoozeUntil: row.snoozeUntil, itemId: row.organizationId ? itemByOrg.get(row.organizationId) ?? null : null,
    }));
}

async function ownedFinding(tenantId: string, id: string) {
  const row = await prisma.radarFinding.findFirst({ where: { id, tenantId }, include: { project: true } });
  if (!row) throw new ApiError(404, "Находка не найдена", "not_found");
  return row;
}

/** «Не то»: статус + пример для понижения похожих. */
export async function rejectFinding(tenantId: string, actorId: string | null, id: string, via: "web" | "bot" = "web") {
  const row = await ownedFinding(tenantId, id);
  if (row.status !== "rejected") {
    await prisma.$transaction([
      prisma.radarFinding.update({ where: { id }, data: { status: "rejected", snoozeUntil: null } }),
      prisma.radarFeedback.create({ data: { tenantId, projectId: row.projectId, findingId: id, text: row.text.slice(0, 1000), via } }),
    ]);
    // Уже лежащие в ленте похожие тоже опускаем — человек сразу видит, что «Не то» сработало.
    const rejected = [row.text];
    const open = await prisma.radarFinding.findMany({ where: { projectId: row.projectId, status: { in: ["new", "later"] }, id: { not: id } }, select: { id: true, text: true, score: true, penalty: true } });
    for (const item of open) {
      const penalty = rejectPenalty(item.text, rejected);
      if (penalty > item.penalty) await prisma.radarFinding.update({ where: { id: item.id }, data: { penalty, score: Math.max(0, item.score - (penalty - item.penalty)) } });
    }
  }
  if (actorId) await audit({ tenantId, actorId, action: "radar.reject", entityType: "radar", entityId: id });
  return { ok: true, status: "rejected" };
}

export async function laterFinding(tenantId: string, actorId: string | null, id: string, hours = 24) {
  await ownedFinding(tenantId, id);
  await prisma.radarFinding.update({ where: { id }, data: { status: "later", snoozeUntil: new Date(Date.now() + hours * 60 * 60 * 1000) } });
  if (actorId) await audit({ tenantId, actorId, action: "radar.later", entityType: "radar", entityId: id });
  return { ok: true, status: "later" };
}

/**
 * «Взять». Для своего проекта — карточка в «Охоте» (Organization source=radar + Outreach «взят», черновик = подсказка),
 * дальше обычный путь: «Скопировать и открыть чат», касания. Для проекта-клиента — только статус (лид заказчика).
 */
export async function takeFinding(tenantId: string, actorId: string | null, id: string) {
  const row = await ownedFinding(tenantId, id);
  if (row.project.kind === "client") {
    await prisma.radarFinding.update({ where: { id }, data: { status: "taken", snoozeUntil: null } });
    if (actorId) await audit({ tenantId, actorId, action: "radar.take", entityType: "radar", entityId: id });
    return { ok: true, status: "taken", itemId: null, chatLink: authorChatLink(row.authorUsername), reply: row.reply };
  }
  const name = row.authorUsername ? `@${row.authorUsername}` : row.authorName || `Запрос из «${row.chatTitle}»`;
  const chat = authorChatLink(row.authorUsername);
  const card: ObservationCard = {
    segment: null,
    observation: row.summary ?? row.text.slice(0, 200),
    money: [],
    chaos: [],
    growth: [{ text: `Запрос в чате «${row.chatTitle}»: ${(row.summary ?? row.text).slice(0, 300)}`, source: row.link ?? "telegram", kind: "fact" }],
    calc: null,
    caseRef: null,
    contact: chat ? [{ kind: "social", value: chat }] : [],
    features: [],
  };
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.upsert({
      where: { tenantId_source_externalId: { tenantId, source: "radar", externalId: row.id } },
      update: {},
      create: {
        tenantId, source: "radar", externalId: row.id, name: name.slice(0, 200), city: row.city, category: "Запрос из Telegram", description: row.text.slice(0, 3000), sourceUrl: row.link,
        processingStatus: "new", firstSeenAt: row.postedAt,
        raw: { radar: { findingId: row.id, chat: row.chatUsername, chatTitle: row.chatTitle, messageId: row.messageId, postedAt: row.postedAt.toISOString(), summary: row.summary, district: row.district, deadline: row.deadline, budget: row.budget, score: row.score } } as Prisma.InputJsonValue,
      },
    });
    if (row.authorUsername) {
      for (const contact of [{ type: "telegram", value: `@${row.authorUsername}` }, { type: "social", value: chat! }]) {
        await tx.organizationContact.upsert({
          where: { organizationId_type_value: { organizationId: org.id, type: contact.type, value: contact.value } },
          update: {},
          create: { tenantId, organizationId: org.id, type: contact.type, value: contact.value, source: "radar" },
        });
      }
    }
    const outreach = await tx.outreach.upsert({
      where: { organizationId: org.id },
      update: {},
      create: { tenantId, organizationId: org.id, segment: null, score: row.score, priority: row.score >= 70 ? "A" : "B", card: card as unknown as Prisma.InputJsonValue, cardStatus: "ready", status: "approved", pitch: row.reply, qualifiedAt: new Date() },
    });
    await tx.radarFinding.update({ where: { id }, data: { status: "taken", snoozeUntil: null, organizationId: org.id } });
    return { organizationId: org.id, itemId: outreach.id };
  });
  await activity({ tenantId, organizationId: result.organizationId, type: "radar.taken", message: `Взят запрос из Telegram-чата «${row.chatTitle}»`, actorId, meta: { findingId: id } });
  if (actorId) await audit({ tenantId, actorId, action: "radar.take", entityType: "radar", entityId: id });
  return { ok: true, status: "taken", itemId: result.itemId, chatLink: chat, reply: row.reply };
}
