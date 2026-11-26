import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { resolveTaskModel } from "../domain/models";
import { completeJson } from "../integrations/openrouter";
import { isReady, requireReady } from "../integrations/config";
import { activity, assertBudget, getSettings, moveLead, recordCost } from "./common";
import { queueSheet } from "./sheets";
import { CHANNELS, LIVE, bounds, contactableOrg, followUpDone, markSent, owned, setStatus, suppressedOrgIds } from "./hunt";
import { chatTargets, channelsOf, type Dossier } from "../domain/dossier";
import { followUpDraft, hasPlaceholder, touchKind } from "../domain/drafts";
import { REPLY_LABEL, TASK_TITLE, buildReplyPrompt, classifyReply, replyAiSchema, replyNext, type ReplyType } from "../domain/replies";
import { changeForTomorrow, decision50, funnelRows, type FunnelRecord } from "../domain/funnel";
import { nextFollowUpAt } from "../domain/pitch";
import { detectPreset, type PresetId } from "../domain/segments";
import { presetLabel } from "../domain/lead-cycle";
import type { Converter } from "../domain/segments";

/**
 * S1 «Цикл лида» (бриф 27.11, сценарии 1, 5, 6, 7): касания, ответы, задачи на фрагмент или демо, план дня и воронка.
 * Никакой отправки отсюда нет: человек копирует текст и отправляет сам, сервис только записывает факт.
 */

const DAY = 24 * 60 * 60 * 1000;
const PLAN_LIMIT = 30;

function presetOf(row: { preset: string | null; segment: string | null; organization: { name: string; category: string | null; categories?: string[] } }): PresetId | null {
  return (row.preset as PresetId | null) ?? detectPreset({ segment: row.segment, name: row.organization.name, category: row.organization.category, categories: row.organization.categories });
}

/* ───────────── Касание: «Скопировать и открыть чат» ───────────── */

export const touchSchema = z.object({
  kind: z.enum(["first", "followup"]),
  channel: z.enum(CHANNELS),
  variant: z.enum(["A", "B"]).optional(),
  text: z.string().trim().min(10).max(2000),
  force: z.boolean().optional(),
});

/** Человек скопировал текст и открыл чат. Записываем касание: канал, вариант, текст, время. */
export async function recordTouch(tenantId: string, actorId: string, role: string, id: string, input: z.infer<typeof touchSchema>) {
  if (hasPlaceholder(input.text)) throw new ApiError(422, "В тексте осталась заглушка в квадратных скобках — впишите факт.", "placeholder");
  const row = await owned(tenantId, id);
  if (input.kind === "first") {
    const result = await markSent(tenantId, actorId, role, id, { channel: input.channel, text: input.text, force: input.force });
    await prisma.outreach.update({ where: { id }, data: { variant: input.variant ?? null } });
    const touch = await prisma.touch.create({ data: { tenantId, outreachId: id, organizationId: row.organizationId, kind: "day1", channel: input.channel, variant: input.variant ?? null, text: input.text, actorId } });
    return { ...result, touchId: touch.id, kind: "day1" };
  }
  const kind = touchKind(row.followUpStep);
  if (!kind) throw new ApiError(409, "Касания дня 4 и 8 уже были — дальше пауза.", "touches_done");
  const result = await followUpDone(tenantId, actorId, id, input.channel);
  const touch = await prisma.touch.create({ data: { tenantId, outreachId: id, organizationId: row.organizationId, kind, channel: input.channel, variant: row.variant, text: input.text, actorId } });
  return { ...result, touchId: touch.id, kind, silent: !result.next };
}

/** Отмена ошибочного нажатия: только последнее касание и только в течение 15 минут. Цифры воронки не засоряются. */
export async function undoTouch(tenantId: string, actorId: string, touchId: string) {
  const touch = await prisma.touch.findFirst({ where: { id: touchId, tenantId } });
  if (!touch) throw new ApiError(404, "Касание не найдено", "not_found");
  if (Date.now() - touch.sentAt.getTime() > 15 * 60 * 1000) throw new ApiError(409, "Отменить можно только в течение 15 минут.", "too_late");
  const last = await prisma.touch.findFirst({ where: { outreachId: touch.outreachId }, orderBy: { sentAt: "desc" } });
  if (last?.id !== touch.id) throw new ApiError(409, "Отменить можно только последнее касание.", "not_last");
  const row = await prisma.outreach.findUniqueOrThrow({ where: { id: touch.outreachId } });
  const since = new Date(touch.sentAt.getTime() - 60 * 1000);
  await prisma.$transaction(async (tx) => {
    if (touch.kind === "day1") {
      if (row.status !== "sent") throw new ApiError(409, "По карточке уже есть движение — отмена невозможна.", "conflict");
      await tx.outreach.update({ where: { id: row.id }, data: { status: "approved", sentAt: null, nextFollowUpAt: null, followUpStep: 0, variant: null } });
      const act = await tx.activity.findFirst({ where: { tenantId, organizationId: row.organizationId, type: "outreach.sent", createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
      if (act) await tx.activity.delete({ where: { id: act.id } });
    } else {
      if (!["sent", "sleeping"].includes(row.status) || !row.sentAt) throw new ApiError(409, "По карточке уже есть движение — отмена невозможна.", "conflict");
      const step = Math.max(0, row.followUpStep - 1);
      await tx.outreach.update({ where: { id: row.id }, data: { status: "sent", followUpStep: step, nextFollowUpAt: nextFollowUpAt(row.sentAt, step) } });
      const act = await tx.activity.findFirst({ where: { tenantId, organizationId: row.organizationId, type: "outreach.followup", createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
      if (act) await tx.activity.delete({ where: { id: act.id } });
    }
    await tx.touch.delete({ where: { id: touch.id } });
  });
  if (touch.kind === "day1") await moveLead(tenantId, row.organizationId, "ready_to_contact", actorId).catch(() => undefined);
  await queueSheet(tenantId, "outreach", row.id);
  return { ok: true };
}

/* ───────────── Ответ клиента ───────────── */

export const replySchema = z.object({ text: z.string().trim().min(1).max(4000) });

const REPLIED_FROM = ["sent", "sleeping", "lost"];

async function aiReplyType(tenantId: string, quote: string, organizationId: string, refId: string): Promise<ReplyType | null> {
  if (!(await isReady(tenantId, "openrouter"))) return null;
  try {
    const settings = await getSettings(tenantId);
    const integration = await requireReady(tenantId, "openrouter", "Разбор ответа");
    await assertBudget(tenantId, settings.ai.maxCostPerBriefUsd);
    const model = resolveTaskModel("message", settings.ai.messageModel || process.env.AI_DEFAULT_MODEL);
    const prompt = buildReplyPrompt(quote);
    const result = await completeJson({ baseUrl: String(integration.config.baseUrl), apiKey: integration.secrets.apiKey, secrets: integration.secrets, model, system: prompt.system, user: prompt.user, schema: replyAiSchema, maxTokens: 60 });
    await recordCost({ tenantId, provider: "openrouter", operation: "reply", amountUsd: typeof result.usage.cost === "number" ? result.usage.cost : null, organizationId, refType: "outreach", refId });
    return result.data.type;
  } catch {
    return null; // AI не ответил — работает правило по ключевым словам
  }
}

/** Вставка ответа: тип (AI или ключевые слова), дословная цитата, следующий шаг вопросами, задача на фрагмент или демо. */
export async function recordReply(tenantId: string, actorId: string, id: string, input: z.infer<typeof replySchema>) {
  const row = await owned(tenantId, id);
  if (!["sent", "sleeping", "lost", ...LIVE].includes(row.status)) throw new ApiError(409, "Сначала отметьте первое сообщение — ответ привязывается к касанию.", "not_sent");
  if (row.rejectReason === "Просит не писать") throw new ApiError(409, "Лид просил не писать.", "opted_out");
  const quote = input.text.trim();
  const ai = await aiReplyType(tenantId, quote, row.organizationId, id);
  const rule = classifyReply(quote);
  const type: ReplyType = ai ?? rule.type;
  const preset = presetOf(row);
  const next = replyNext(type, preset);
  const reply = await prisma.leadReply.create({ data: { tenantId, outreachId: id, quote, type, method: ai ? "ai" : "rules", next: next as unknown as Prisma.InputJsonValue, actorId } });

  const firstReply = REPLIED_FROM.includes(row.status);
  if (next.status === "replied") {
    if (firstReply) await setStatus(tenantId, actorId, id, { status: "replied", note: `${REPLY_LABEL[type]}: «${quote.slice(0, 200)}»` });
    else await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.reply", message: `${REPLY_LABEL[type]}: «${quote.slice(0, 200)}»` });
  } else {
    // «Не сейчас» и отказ — тоже ответы: в процент ответов они входят.
    if (firstReply && row.status !== "lost") await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.replied", message: `${REPLY_LABEL[type]}: «${quote.slice(0, 200)}»` });
    if (next.status === "lost" && row.status !== "lost") {
      await setStatus(tenantId, actorId, id, { status: "lost", note: "Отказ в ответе" });
      await prisma.outreach.update({ where: { id }, data: { repliedAt: row.repliedAt ?? new Date() } });
    }
    if (next.status === "sleeping") {
      await prisma.outreach.update({ where: { id }, data: { status: "sleeping", nextFollowUpAt: null, repliedAt: row.repliedAt ?? new Date() } });
      if (!firstReply) await activity({ tenantId, organizationId: row.organizationId, actorId, type: "outreach.reply", message: `Не сейчас: «${quote.slice(0, 200)}»` });
    }
  }

  let taskId: string | null = null;
  if (next.task) {
    const open = await prisma.leadTask.findFirst({ where: { outreachId: id, kind: next.task, status: "open" } });
    taskId = open?.id ?? (await prisma.leadTask.create({ data: { tenantId, outreachId: id, kind: next.task, title: TASK_TITLE[next.task], dueAt: new Date(Date.now() + DAY) } })).id;
  }
  await queueSheet(tenantId, "outreach", id);
  return { id: reply.id, type, label: REPLY_LABEL[type], method: ai ? "ai" : "rules", quote, next, taskId };
}

/* ───────────── Задачи: фрагмент 15 сек или демо ───────────── */

export async function finishTask(tenantId: string, actorId: string, taskId: string) {
  const task = await prisma.leadTask.findFirst({ where: { id: taskId, tenantId }, include: { outreach: { select: { organizationId: true } } } });
  if (!task) throw new ApiError(404, "Задача не найдена", "not_found");
  if (task.status === "done") return { ok: true };
  await prisma.leadTask.update({ where: { id: task.id }, data: { status: "done", doneAt: new Date() } });
  await activity({ tenantId, organizationId: task.outreach.organizationId, actorId, type: "outreach.prototype", message: `Готово: ${task.title}` });
  return { ok: true };
}

/* ───────────── «Сегодня»: не больше 30 действий ───────────── */

const planInclude = {
  organization: { select: { id: true, name: true, city: true, category: true, categories: true, contacts: { select: { type: true, value: true } } } },
} as const;

type PlanRow = Prisma.OutreachGetPayload<{ include: typeof planInclude }>;

export type PlanAction = {
  key: string;
  kind: "task" | "dialog" | "day4" | "day8" | "write" | "new";
  outreachId: string;
  name: string;
  city: string | null;
  grade: string | null;
  preset: string | null;
  presetLabel: string | null;
  note: string;
  text: string | null;
  taskId: string | null;
  targets: ReturnType<typeof chatTargets>;
};

function targetsOf(row: PlanRow) {
  const dossier = row.dossier as unknown as Dossier | null;
  return chatTargets(dossier?.channels ?? channelsOf(row.organization.contacts));
}

function action(row: PlanRow, kind: PlanAction["kind"], note: string, text: string | null = null, taskId: string | null = null): PlanAction {
  const preset = presetOf(row);
  return { key: `${kind}:${taskId ?? row.id}`, kind, outreachId: row.id, name: row.organization.name, city: row.organization.city, grade: row.grade, preset, presetLabel: presetLabel(preset), note, text, taskId, targets: kind === "day4" || kind === "day8" ? targetsOf(row) : [] };
}

/**
 * План дня: задачи на фрагмент или демо → ответы клиентам → касания дня 4 и 8 с текстами → взятые в работу → новые A.
 * Всего не больше 30 — остальное ждёт завтра.
 */
export async function plan(tenantId: string) {
  const { end, start } = await bounds(tenantId);
  const now = new Date();
  const [tasks, dialogsDue, touchesDue, approved, fresh, sentToday] = await Promise.all([
    prisma.leadTask.findMany({ where: { tenantId, status: "open" }, include: { outreach: { include: planInclude } }, orderBy: [{ dueAt: "asc" }], take: PLAN_LIMIT }),
    prisma.outreach.findMany({ where: { tenantId, status: { in: LIVE }, nextFollowUpAt: { lte: end }, organization: contactableOrg }, include: planInclude, orderBy: { nextFollowUpAt: "asc" }, take: PLAN_LIMIT }),
    prisma.outreach.findMany({ where: { tenantId, status: "sent", nextFollowUpAt: { lte: end }, organization: contactableOrg }, include: planInclude, orderBy: { nextFollowUpAt: "asc" }, take: PLAN_LIMIT }),
    prisma.outreach.findMany({ where: { tenantId, status: "approved", organization: contactableOrg }, include: planInclude, orderBy: [{ grade: { sort: "asc", nulls: "last" } }, { score: "desc" }], take: PLAN_LIMIT }),
    prisma.outreach.findMany({
      where: { tenantId, cardStatus: "ready", OR: [{ grade: "A" }, { grade: null, priority: "A" }], AND: [{ OR: [{ status: "new" }, { status: "snoozed", snoozeUntil: { lte: now } }] }], organization: contactableOrg },
      include: planInclude,
      orderBy: { score: "desc" },
      take: PLAN_LIMIT * 2,
    }),
    prisma.touch.count({ where: { tenantId, kind: "day1", sentAt: { gte: start } } }),
  ]);
  const blocked = await suppressedOrgIds(tenantId, [...dialogsDue, ...touchesDue, ...approved, ...fresh]);
  const ok = (row: PlanRow) => !blocked.has(row.organizationId);
  const seen = new Set<string>();
  const actions: PlanAction[] = [];
  const push = (item: PlanAction) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    actions.push(item);
  };
  for (const task of tasks) push(action(task.outreach, "task", task.title, null, task.id));
  for (const row of dialogsDue.filter(ok)) push(action(row, "dialog", "Ответил — пора следующий шаг"));
  for (const row of touchesDue.filter(ok)) {
    const kind = touchKind(row.followUpStep);
    if (!kind) continue;
    push(action(row, kind, kind === "day4" ? "День 4: пример или кейс" : "День 8: польза без продажи", followUpDraft(row.followUpStep, presetOf(row), row.organization.category, row.segment)));
  }
  for (const row of approved.filter(ok)) push(action(row, "write", "Взята в работу — отправьте первое сообщение"));
  for (const row of fresh.filter(ok)) push(action(row, "new", (row.dossier as unknown as Dossier | null)?.hook && (row.dossier as unknown as Dossier).hook !== "NOT_FOUND" ? (row.dossier as unknown as Dossier).hook : "Новая A — откройте черновик"));
  const counts = { task: 0, dialog: 0, day4: 0, day8: 0, write: 0, new: 0 } as Record<PlanAction["kind"], number>;
  for (const item of actions) counts[item.kind] += 1;
  return { actions: actions.slice(0, PLAN_LIMIT), total: actions.length, limit: PLAN_LIMIT, more: Math.max(0, actions.length - PLAN_LIMIT), counts, sentToday };
}

/* ───────────── Воронка по сегментам и вариантам, правило 50, итог дня ───────────── */

export async function funnel(tenantId: string, days?: number) {
  const { start } = await bounds(tenantId);
  const since = days ? new Date(Date.now() - days * DAY) : null;
  const rows = await prisma.outreach.findMany({
    where: { tenantId, sentAt: since ? { gte: since } : { not: null } },
    select: {
      id: true, organizationId: true, preset: true, segment: true, variant: true, status: true, repliedAt: true,
      organization: { select: { name: true, category: true, categories: true } },
      replies: { select: { type: true } },
      tasks: { select: { status: true } },
    },
    take: 5000,
  });
  const orgIds = rows.map((row) => row.organizationId);
  const acts = orgIds.length ? await prisma.activity.findMany({ where: { tenantId, organizationId: { in: orgIds }, type: { in: ["outreach.call", "outreach.estimate", "outreach.won"] } }, select: { organizationId: true, type: true } }) : [];
  const has = (orgId: string, type: string) => acts.some((item) => item.organizationId === orgId && item.type === type);
  const records: FunnelRecord[] = rows.map((row) => ({
    preset: presetOf({ preset: row.preset, segment: row.segment, organization: row.organization }),
    variant: row.variant,
    replied: Boolean(row.repliedAt) || row.replies.length > 0,
    interest: row.replies.some((item) => item.type === "interested" || item.type === "price") || ["demo", "call", "estimate", "won"].includes(row.status),
    prototype: row.tasks.some((item) => item.status === "done"),
    call: has(row.organizationId, "outreach.call") || ["call", "estimate", "won"].includes(row.status),
    proposal: has(row.organizationId, "outreach.estimate") || ["estimate", "won"].includes(row.status),
    prepaid: has(row.organizationId, "outreach.won") || row.status === "won",
  }));
  const table = funnelRows(records);
  const decisions = [
    { key: "total", label: "Всего", ...decision50({ sent: table.total.sent, replies: table.total.replies, calls: table.total.calls }) },
    ...table.bySegment.filter((item) => item.key !== "none").map((item) => ({ key: item.key, label: item.label, ...decision50({ sent: item.sent, replies: item.replies, calls: item.calls }) })),
  ];

  // Итог дня: сегодняшние первые касания по сегментам и вариантам, ответы, задачи.
  const [touchesToday, repliesToday, tasksDoneToday, openTasks] = await Promise.all([
    prisma.touch.findMany({ where: { tenantId, sentAt: { gte: start } }, select: { kind: true, variant: true, outreach: { select: { preset: true, segment: true, organization: { select: { name: true, category: true, categories: true } } } } } }),
    prisma.leadReply.findMany({ where: { tenantId, createdAt: { gte: start } }, select: { type: true } }),
    prisma.leadTask.count({ where: { tenantId, status: "done", doneAt: { gte: start } } }),
    prisma.leadTask.count({ where: { tenantId, status: "open" } }),
  ]);
  const first = touchesToday.filter((item) => item.kind === "day1");
  const groups = new Map<string, number>();
  for (const item of first) {
    const key = `${presetLabel(presetOf(item.outreach)) ?? "Без сегмента"} · ${item.variant ?? "—"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const replyTypes = new Map<string, number>();
  for (const item of repliesToday) replyTypes.set(REPLY_LABEL[item.type as ReplyType] ?? item.type, (replyTypes.get(REPLY_LABEL[item.type as ReplyType] ?? item.type) ?? 0) + 1);
  const day = {
    sent: first.length,
    followUps: touchesToday.length - first.length,
    replies: repliesToday.length,
    interest: repliesToday.filter((item) => item.type === "interested" || item.type === "price").length,
    tasksDone: tasksDoneToday,
    openTasks,
    bySegmentVariant: [...groups.entries()].map(([label, count]) => ({ label, count })),
    replyTypes: [...replyTypes.entries()].map(([label, count]) => ({ label, count })),
    change: changeForTomorrow({ sentToday: first.length, openTasks, byVariant: table.byVariant, total: table.total }),
  };
  return { days: days ?? null, ...table, decisions, day };
}

export type TaskKind = Converter;
