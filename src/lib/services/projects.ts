import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { requestJson, safeDetail } from "../http";
import { isPublicHttpUrl } from "../domain/website";
import { PROJECT_STAGES, checklistFrom, isProjectStage, scenarioOf } from "../domain/scenarios";
import { isSegment, segmentInfo } from "../domain/segments";
import type { ObservationCard } from "../domain/qualify";
import { enqueueJob } from "../jobs/queue";
import { activity, audit, getSettings } from "./common";
import { queueSheet } from "./sheets";

export const PROJECT_SCHEMA = "leadflow.project.v1";

type ChecklistItem = { id: string; title: string; done: boolean };

const projectInclude = {
  organization: { include: { contacts: true } },
  outreach: true,
} as const;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

function checklistOf(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChecklistItem => Boolean(item) && typeof item === "object" && typeof (item as ChecklistItem).title === "string")
    .map((item, index) => ({ id: String(item.id || `s${index + 1}`), title: item.title, done: Boolean(item.done) }));
}

/** Полный снимок проекта для API, вебхука и таблицы. Версия схемы — в поле schema. */
export function projectJson(row: ProjectRow) {
  const scenario = scenarioOf(row.scenarioId);
  const card = (row.outreach?.card ?? null) as unknown as ObservationCard | null;
  const checklist = checklistOf(row.checklist);
  const org = row.organization;
  return {
    schema: PROJECT_SCHEMA,
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source,
    title: row.title,
    product: row.product,
    stage: row.stage,
    stageLabel: PROJECT_STAGES.find((item) => item.key === row.stage)?.label ?? row.stage,
    amountRub: row.amount,
    deadline: row.deadlineAt ? row.deadlineAt.toISOString().slice(0, 10) : null,
    progress: { done: checklist.filter((item) => item.done).length, total: checklist.length },
    checklist,
    contact: { name: row.contactName, value: row.contactValue },
    notes: row.notes,
    scenario: scenario
      ? { id: scenario.id, title: scenario.title, contour: scenario.contour, product: scenario.product, features: scenario.features, priceFromRub: scenario.priceFrom, priceToRub: scenario.priceTo, days: scenario.days, demo: scenario.demo, caseRef: scenario.caseRef }
      : null,
    organization: org
      ? {
          id: org.id,
          name: org.name,
          city: org.city,
          address: org.address,
          category: org.category,
          website: org.website,
          websiteStatus: org.websiteStatus,
          rating: org.rating,
          reviewCount: org.reviewCount,
          sourceUrl: org.sourceUrl,
          phones: org.contacts.filter((item) => item.type === "phone").map((item) => item.value),
          emails: org.contacts.filter((item) => item.type === "email").map((item) => item.value),
          socials: org.contacts.filter((item) => item.type === "social").map((item) => item.value),
        }
      : null,
    lead: row.outreach
      ? {
          id: row.outreach.id,
          segment: row.outreach.segment,
          segmentLabel: segmentInfo(row.outreach.segment)?.label ?? null,
          priority: row.outreach.priority,
          score: row.outreach.score,
          status: row.outreach.status,
          money: card?.money.map((item) => item.text) ?? [],
          chaos: card?.chaos.map((item) => item.text) ?? [],
          hook: card?.observation ?? null,
          pitch: row.outreach.pitch,
          sentAt: row.outreach.sentAt?.toISOString() ?? null,
          channel: row.outreach.channel,
          repliedAt: row.outreach.repliedAt?.toISOString() ?? null,
        }
      : null,
  };
}

async function refreshSnapshot(id: string) {
  const row = await prisma.project.findUniqueOrThrow({ where: { id }, include: projectInclude });
  const data = projectJson(row);
  await prisma.project.update({ where: { id }, data: { data: data as unknown as Prisma.InputJsonValue } });
  await queueSheet(row.tenantId, "project", id);
  return { ...row, data };
}

export const projectCreateSchema = z.object({
  outreachId: z.string().min(1).optional(),
  scenarioId: z.string().optional(),
  title: z.string().trim().min(2).max(160).optional(),
  product: z.string().trim().max(200).optional(),
  amount: z.number().int().min(0).max(100_000_000).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactValue: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
});

/** Создать проект. Из карточки охоты — один проект на карточку (повторный вызов вернёт существующий). */
export async function createProject(tenantId: string, actorId: string | null, input: z.infer<typeof projectCreateSchema>, source = "manual") {
  let organizationId: string | null = null;
  let scenarioId = input.scenarioId && isSegment(input.scenarioId) ? input.scenarioId : null;
  let title = input.title ?? null;
  let contactValue = input.contactValue ?? null;
  if (input.outreachId) {
    const existing = await prisma.project.findUnique({ where: { outreachId: input.outreachId } });
    if (existing) {
      if (existing.tenantId !== tenantId) throw new ApiError(404, "Карточка не найдена", "not_found");
      return { project: await getProject(tenantId, existing.id), created: false };
    }
    const outreach = await prisma.outreach.findFirst({ where: { id: input.outreachId, tenantId }, include: { organization: { include: { contacts: true } } } });
    if (!outreach) throw new ApiError(404, "Карточка не найдена", "not_found");
    organizationId = outreach.organizationId;
    scenarioId = scenarioId ?? (isSegment(outreach.segment) ? outreach.segment : null);
    title = title ?? outreach.organization.name;
    contactValue = contactValue ?? outreach.organization.contacts.find((item) => item.type === "phone")?.value ?? outreach.organization.contacts[0]?.value ?? null;
  }
  if (!title) throw new ApiError(400, "Укажите название проекта", "validation");
  const scenario = scenarioOf(scenarioId);
  try {
    const project = await prisma.project.create({
      data: {
        tenantId,
        organizationId,
        outreachId: input.outreachId ?? null,
        scenarioId,
        title,
        product: input.product ?? scenario?.product ?? null,
        amount: input.amount ?? (scenario ? scenario.priceFrom : null),
        contactName: input.contactName ?? null,
        contactValue,
        notes: input.notes ?? null,
        checklist: checklistFrom(scenario) as unknown as Prisma.InputJsonValue,
        source,
        createdById: actorId,
      },
    });
    await activity({ tenantId, organizationId, actorId, type: "project.created", message: `Создан проект «${title}»` });
    if (actorId) await audit({ tenantId, actorId, action: "project.create", entityType: "project", entityId: project.id });
    await refreshSnapshot(project.id);
    await queueWebhook(tenantId, project.id, "project.created");
    return { project: await getProject(tenantId, project.id), created: true };
  } catch (error) {
    // Два клика «Смета» одновременно: второй упирается в уникальность outreachId и получает уже созданный проект.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.outreachId) {
      const existing = await prisma.project.findUniqueOrThrow({ where: { outreachId: input.outreachId } });
      return { project: await getProject(tenantId, existing.id), created: false };
    }
    throw error;
  }
}

function publicProject(row: ProjectRow) {
  const checklist = checklistOf(row.checklist);
  return {
    id: row.id,
    title: row.title,
    product: row.product,
    stage: row.stage,
    amount: row.amount,
    deadlineAt: row.deadlineAt,
    contactName: row.contactName,
    contactValue: row.contactValue,
    notes: row.notes,
    checklist,
    progress: { done: checklist.filter((item) => item.done).length, total: checklist.length },
    scenarioId: row.scenarioId,
    scenarioTitle: scenarioOf(row.scenarioId)?.title ?? null,
    organization: row.organization ? { id: row.organization.id, name: row.organization.name, city: row.organization.city } : null,
    outreachId: row.outreachId,
    source: row.source,
    sheetSyncedAt: row.sheetSyncedAt,
    webhookAt: row.webhookAt,
    webhookError: row.webhookError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProjects(tenantId: string, stage?: string | null) {
  const rows = await prisma.project.findMany({
    where: { tenantId, ...(stage && isProjectStage(stage) ? { stage } : {}) },
    include: projectInclude,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const totals = await prisma.project.groupBy({ by: ["stage"], where: { tenantId }, _count: { _all: true }, _sum: { amount: true } });
  return {
    items: rows.map(publicProject),
    byStage: PROJECT_STAGES.map((item) => {
      const hit = totals.find((total) => total.stage === item.key);
      return { key: item.key, label: item.label, count: hit?._count._all ?? 0, amount: hit?._sum.amount ?? 0 };
    }),
  };
}

export async function getProject(tenantId: string, id: string) {
  const row = await prisma.project.findFirst({ where: { id, tenantId }, include: projectInclude });
  if (!row) throw new ApiError(404, "Проект не найден", "not_found");
  return publicProject(row);
}

export const projectPatchSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  product: z.string().trim().max(200).nullable().optional(),
  stage: z.string().optional(),
  amount: z.number().int().min(0).max(100_000_000).nullable().optional(),
  deadlineAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactValue: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  toggle: z.string().max(20).optional(),
  addItem: z.string().trim().min(2).max(160).optional(),
});

export async function updateProject(tenantId: string, actorId: string, id: string, patch: z.infer<typeof projectPatchSchema>) {
  const row = await prisma.project.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(404, "Проект не найден", "not_found");
  if (patch.stage !== undefined && !isProjectStage(patch.stage)) throw new ApiError(400, "Такого этапа нет", "validation");
  let checklist = checklistOf(row.checklist);
  if (patch.toggle) checklist = checklist.map((item) => (item.id === patch.toggle ? { ...item, done: !item.done } : item));
  if (patch.addItem) checklist = [...checklist, { id: `c${Date.now().toString(36)}`, title: patch.addItem, done: false }];
  await prisma.project.update({
    where: { id },
    data: {
      title: patch.title,
      product: patch.product,
      stage: patch.stage,
      amount: patch.amount,
      deadlineAt: patch.deadlineAt === undefined ? undefined : patch.deadlineAt ? new Date(`${patch.deadlineAt}T00:00:00Z`) : null,
      contactName: patch.contactName,
      contactValue: patch.contactValue,
      notes: patch.notes,
      checklist: checklist as unknown as Prisma.InputJsonValue,
    },
  });
  if (patch.stage && patch.stage !== row.stage) {
    await activity({ tenantId, organizationId: row.organizationId, actorId, type: "project.stage", message: `Проект «${row.title}»: этап ${PROJECT_STAGES.find((item) => item.key === patch.stage)?.label}` });
  }
  await refreshSnapshot(id);
  return getProject(tenantId, id);
}

export async function projectExport(tenantId: string, id: string) {
  const row = await prisma.project.findFirst({ where: { id, tenantId }, include: projectInclude });
  if (!row) throw new ApiError(404, "Проект не найден", "not_found");
  return projectJson(row);
}

/* ───────────── Вебхук: JSON проекта во внешнюю систему ───────────── */

async function queueWebhook(tenantId: string, projectId: string, event: string) {
  const settings = await getSettings(tenantId);
  if (!settings.hunt.projectWebhookUrl) return false;
  await enqueueJob({ tenantId, type: "project.webhook", payload: { projectId, event }, idempotencyKey: `webhook:${projectId}:${event}:${Date.now()}` });
  return true;
}

export async function resendWebhook(tenantId: string, id: string) {
  await getProject(tenantId, id);
  const queued = await queueWebhook(tenantId, id, "project.updated");
  if (!queued) throw new ApiError(409, "Адрес для JSON не задан. Укажите его в настройках охоты.", "webhook_not_configured");
  return { queued: true };
}

export async function deliverWebhook(projectId: string, event: string) {
  const row = await prisma.project.findUnique({ where: { id: projectId }, include: projectInclude });
  if (!row) return;
  const settings = await getSettings(row.tenantId);
  const target = settings.hunt.projectWebhookUrl;
  if (!target) return;
  const checked = isPublicHttpUrl(target);
  if (!checked.ok) {
    await prisma.project.update({ where: { id: projectId }, data: { webhookError: `Адрес отклонён: ${checked.reason}` } });
    return;
  }
  const { response, body } = await requestJson(checked.url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LeadFlow-Event": event, "X-LeadFlow-Schema": PROJECT_SCHEMA },
    body: JSON.stringify({ event, sentAt: new Date().toISOString(), project: projectJson(row) }),
    redirect: "manual",
    timeoutMs: 20000,
  });
  if (!response.ok) {
    const message = `Ответ ${response.status}${safeDetail(body) ? `: ${safeDetail(body)}` : ""}`;
    await prisma.project.update({ where: { id: projectId }, data: { webhookError: message } });
    if (response.status >= 500 || response.status === 429) throw new Error(message);
    return;
  }
  await prisma.project.update({ where: { id: projectId }, data: { webhookAt: new Date(), webhookError: null } });
}
