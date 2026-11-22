import "server-only";
import { prisma } from "../db";
import { isReady, resolveIntegration } from "../integrations/config";
import { upsertRows } from "../integrations/sheets";
import { enqueueJob } from "../jobs/queue";
import { segmentInfo } from "../domain/segments";
import { scenarioOf, PROJECT_STAGES } from "../domain/scenarios";
import type { ObservationCard } from "../domain/qualify";

/** Зеркало в Google Таблицу: лист «Лиды» (квалифицированные карточки и касания) и «Проекты». */

export const LEAD_SHEET = "Лиды";
export const PROJECT_SHEET = "Проекты";

const LEAD_HEADER = ["id", "Компания", "Город", "Ниша", "Приоритет", "Балл", "Статус", "Деньги", "Хаос", "Крючок", "Телефоны", "Соцсети", "Источник", "Квалифицирован", "Отправлено", "Канал", "Напоминаний", "След. напоминание", "Ответ", "Обновлено"];
const PROJECT_HEADER = ["id", "Создан", "Проект", "Компания", "Город", "Сценарий", "Продукт", "Этап", "Сумма, ₽", "Дедлайн", "Прогресс", "Контакт", "Заметки", "Обновлено", "JSON"];

const STATUS: Record<string, string> = { new: "Новая", approved: "В работе", rejected: "Отклонена", snoozed: "Отложена", sent: "Отправлено", replied: "Ответил", call: "Созвон", estimate: "Смета", won: "Сделка", lost: "Отказ", sleeping: "Спящий" };

function day(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "";
}

/** Поставить строку в очередь. Частые изменения одной карточки склеиваются в одну запись за 10 секунд. */
export async function queueSheet(tenantId: string, kind: "outreach" | "project", id: string) {
  try {
    if (!(await isReady(tenantId, "sheets"))) return;
    await enqueueJob({ tenantId, type: "sheets.push", payload: { kind, id }, delayMs: 3000, idempotencyKey: `sheets:${kind}:${id}:${Math.floor(Date.now() / 10000)}` });
  } catch {
    // Таблица — зеркало: её сбой не должен ломать основное действие.
  }
}

async function leadRows(where: { tenantId: string; id?: { in: string[] } }) {
  const rows = await prisma.outreach.findMany({
    where: { ...where, cardStatus: { in: ["ready", "no_fact"] } },
    include: { organization: { include: { contacts: true } } },
    orderBy: { updatedAt: "desc" },
    take: 2000,
  });
  return rows.map((row) => {
    const card = row.card as unknown as ObservationCard | null;
    return {
      record: row,
      values: {
        id: row.id,
        "Компания": row.organization.name,
        "Город": row.organization.city ?? "",
        "Ниша": segmentInfo(row.segment)?.label ?? "",
        "Приоритет": row.priority,
        "Балл": row.score,
        "Статус": STATUS[row.status] ?? row.status,
        "Деньги": card?.money.map((item) => item.text).join("; ") ?? "",
        "Хаос": card?.chaos.map((item) => item.text).join("; ") ?? "",
        "Крючок": card?.observation ?? "",
        "Телефоны": row.organization.contacts.filter((item) => item.type === "phone").map((item) => item.value).join(", "),
        "Соцсети": row.organization.contacts.filter((item) => item.type === "social").map((item) => item.value).join(", "),
        "Источник": row.organization.sourceUrl ?? "",
        "Квалифицирован": day(row.qualifiedAt),
        "Отправлено": day(row.sentAt),
        "Канал": row.channel ?? "",
        "Напоминаний": row.followUpStep,
        "След. напоминание": day(row.nextFollowUpAt),
        "Ответ": day(row.repliedAt),
        "Обновлено": day(row.updatedAt),
      },
    };
  });
}

async function projectRows(where: { tenantId: string; id?: { in: string[] } }) {
  const rows = await prisma.project.findMany({ where, include: { organization: true }, orderBy: { updatedAt: "desc" }, take: 2000 });
  return rows.map((row) => {
    const checklist = Array.isArray(row.checklist) ? (row.checklist as { done?: boolean }[]) : [];
    return {
      record: row,
      values: {
        id: row.id,
        "Создан": day(row.createdAt),
        "Проект": row.title,
        "Компания": row.organization?.name ?? "",
        "Город": row.organization?.city ?? "",
        "Сценарий": scenarioOf(row.scenarioId)?.title ?? "",
        "Продукт": row.product ?? "",
        "Этап": PROJECT_STAGES.find((item) => item.key === row.stage)?.label ?? row.stage,
        "Сумма, ₽": row.amount ?? "",
        "Дедлайн": row.deadlineAt ? row.deadlineAt.toISOString().slice(0, 10) : "",
        "Прогресс": `${checklist.filter((item) => item.done).length}/${checklist.length}`,
        "Контакт": [row.contactName, row.contactValue].filter(Boolean).join(" · "),
        "Заметки": row.notes ?? "",
        "Обновлено": day(row.updatedAt),
        "JSON": row.data ? JSON.stringify(row.data).slice(0, 45000) : "",
      },
    };
  });
}

export async function runSheetPush(kind: string, id: string) {
  const record = kind === "project" ? await prisma.project.findUnique({ where: { id } }) : await prisma.outreach.findUnique({ where: { id } });
  if (!record) return;
  const integration = await resolveIntegration(record.tenantId, "sheets");
  if (!integration.configured || integration.status !== "connected") return;
  if (kind === "project") {
    const rows = await projectRows({ tenantId: record.tenantId, id: { in: [id] } });
    await upsertRows(integration.secrets, PROJECT_SHEET, PROJECT_HEADER, rows.map((row) => row.values));
    await prisma.project.update({ where: { id }, data: { sheetSyncedAt: new Date() } });
  } else {
    const rows = await leadRows({ tenantId: record.tenantId, id: { in: [id] } });
    await upsertRows(integration.secrets, LEAD_SHEET, LEAD_HEADER, rows.map((row) => row.values));
    if (rows.length) await prisma.outreach.update({ where: { id }, data: { sheetSyncedAt: new Date() } });
  }
}

/** Полная выгрузка: все квалифицированные карточки и проекты, пачками по 200 строк. */
export async function runSheetFull(tenantId: string) {
  const integration = await resolveIntegration(tenantId, "sheets");
  if (!integration.configured || integration.status !== "connected") return { leads: 0, projects: 0 };
  const leads = await leadRows({ tenantId });
  for (let i = 0; i < leads.length; i += 200) {
    const chunk = leads.slice(i, i + 200);
    await upsertRows(integration.secrets, LEAD_SHEET, LEAD_HEADER, chunk.map((row) => row.values));
    await prisma.outreach.updateMany({ where: { id: { in: chunk.map((row) => row.record.id) } }, data: { sheetSyncedAt: new Date() } });
  }
  const projects = await projectRows({ tenantId });
  for (let i = 0; i < projects.length; i += 200) {
    const chunk = projects.slice(i, i + 200);
    await upsertRows(integration.secrets, PROJECT_SHEET, PROJECT_HEADER, chunk.map((row) => row.values));
    await prisma.project.updateMany({ where: { id: { in: chunk.map((row) => row.record.id) } }, data: { sheetSyncedAt: new Date() } });
  }
  return { leads: leads.length, projects: projects.length };
}

export async function sheetStatus(tenantId: string) {
  const integration = await resolveIntegration(tenantId, "sheets");
  const [leads, projects, lastLead, pending] = await Promise.all([
    prisma.outreach.count({ where: { tenantId, sheetSyncedAt: { not: null } } }),
    prisma.project.count({ where: { tenantId, sheetSyncedAt: { not: null } } }),
    prisma.outreach.findFirst({ where: { tenantId, sheetSyncedAt: { not: null } }, orderBy: { sheetSyncedAt: "desc" }, select: { sheetSyncedAt: true } }),
    prisma.job.count({ where: { tenantId, type: { in: ["sheets.push", "sheets.full"] }, status: { in: ["queued", "running"] } } }),
  ]);
  const failed = await prisma.job.findFirst({ where: { tenantId, type: { in: ["sheets.push", "sheets.full"] }, status: { in: ["failed", "dead"] } }, orderBy: { finishedAt: "desc" }, select: { error: true, finishedAt: true } });
  return {
    configured: integration.configured,
    status: integration.status,
    lastError: integration.lastError ?? failed?.error ?? null,
    leads,
    projects,
    lastSyncAt: lastLead?.sheetSyncedAt ?? null,
    pending,
  };
}

export async function queueFullSync(tenantId: string) {
  await enqueueJob({ tenantId, type: "sheets.full", payload: { tenantId }, idempotencyKey: `sheets:full:${Math.floor(Date.now() / 60000)}` });
  return { queued: true };
}
