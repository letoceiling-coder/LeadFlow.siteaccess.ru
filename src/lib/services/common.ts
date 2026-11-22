import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { mergeSettings, type TenantSettings } from "../domain/settings";
import { PIPELINE } from "../domain/labels";

export async function getSettings(tenantId: string): Promise<TenantSettings> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Рабочее пространство не найдено", "tenant_not_found");
  return mergeSettings(tenant.settings);
}

export async function audit(input: {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: unknown;
  ip?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      meta: input.meta == null ? undefined : (input.meta as Prisma.InputJsonValue),
      ip: input.ip ?? null,
    },
  });
}

export async function notify(tenantId: string, title: string, body: string, href?: string, userId?: string) {
  await prisma.notification.create({ data: { tenantId, title, body, href, userId } });
}

export async function activity(input: {
  tenantId: string;
  organizationId?: string | null;
  leadId?: string | null;
  type: string;
  message: string;
  actorId?: string | null;
  meta?: unknown;
}) {
  await prisma.activity.create({
    data: {
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
      leadId: input.leadId ?? null,
      type: input.type,
      message: input.message,
      actorId: input.actorId ?? null,
      meta: input.meta == null ? undefined : (input.meta as Prisma.InputJsonValue),
    },
  });
}

export async function ensureStages(tenantId: string) {
  const count = await prisma.pipelineStage.count({ where: { tenantId } });
  if (count > 0) return;
  await prisma.pipelineStage.createMany({
    data: PIPELINE.map((stage, index) => ({
      tenantId,
      key: stage.key,
      name: stage.name,
      position: index,
      isTerminal: Boolean(stage.terminal),
    })),
  });
}

export async function ensureLead(tenantId: string, organizationId: string) {
  const existing = await prisma.lead.findUnique({ where: { organizationId } });
  if (existing) return existing;
  await ensureStages(tenantId);
  const stage = await prisma.pipelineStage.findUnique({ where: { tenantId_key: { tenantId, key: "new" } } });
  if (!stage) throw new ApiError(500, "Не удалось подготовить воронку", "pipeline_missing");
  return prisma.lead.create({ data: { tenantId, organizationId, stageId: stage.id } });
}

export async function moveLead(tenantId: string, organizationId: string, stageKey: string, actorId?: string) {
  const lead = await ensureLead(tenantId, organizationId);
  const stage = await prisma.pipelineStage.findFirst({ where: { tenantId, key: stageKey } });
  if (!stage) throw new ApiError(400, "Такой стадии нет", "stage_not_found");
  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { stageId: stage.id } });
  await activity({
    tenantId,
    organizationId,
    leadId: lead.id,
    actorId,
    type: "stage",
    message: `Стадия изменена на «${stage.name}»`,
  });
  if (stageKey === "do_not_contact") {
    const contacts = await prisma.organizationContact.findMany({ where: { organizationId } });
    const values = [`org:${organizationId}`, ...contacts.map((contact) => contact.value.toLowerCase())];
    for (const value of values) {
      await prisma.suppressionEntry.upsert({
        where: { tenantId_channel_value: { tenantId, channel: "*", value } },
        update: { reason: "Стадия «Не связываться»" },
        create: { tenantId, channel: "*", value, reason: "Стадия «Не связываться»" },
      });
    }
  }
  return updated;
}

export async function assertBudget(tenantId: string, estimatedUsd: number) {
  const settings = await getSettings(tenantId);
  if (estimatedUsd > settings.budgets.perOperationUsd) {
    throw new ApiError(
      409,
      `Оценка ${estimatedUsd} USD выше лимита одной операции (${settings.budgets.perOperationUsd} USD).`,
      "budget_operation",
      "Уменьшите объём или измените лимит в настройках.",
    );
  }
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [daily, monthly] = await Promise.all([
    prisma.costRecord.aggregate({ where: { tenantId, createdAt: { gte: dayStart }, unknown: false }, _sum: { amountUsd: true } }),
    prisma.costRecord.aggregate({ where: { tenantId, createdAt: { gte: monthStart }, unknown: false }, _sum: { amountUsd: true } }),
  ]);
  const day = daily._sum.amountUsd ?? 0;
  const month = monthly._sum.amountUsd ?? 0;
  if (day + estimatedUsd > settings.budgets.dailyUsd) {
    throw new ApiError(409, "Дневной лимит расходов достигнут. Операция не запущена.", "budget_daily");
  }
  if (month + estimatedUsd > settings.budgets.monthlyUsd) {
    throw new ApiError(409, "Месячный лимит расходов достигнут. Операция не запущена.", "budget_monthly");
  }
  return { warn: day + estimatedUsd >= settings.budgets.dailyUsd * 0.8, day, month, settings };
}

export async function recordCost(input: {
  tenantId: string;
  provider: string;
  operation: string;
  amountUsd: number | null;
  organizationId?: string;
  refType?: string;
  refId?: string;
}) {
  await prisma.costRecord.create({
    data: {
      tenantId: input.tenantId,
      provider: input.provider,
      operation: input.operation,
      amountUsd: input.amountUsd,
      unknown: input.amountUsd == null,
      organizationId: input.organizationId,
      refType: input.refType,
      refId: input.refId,
    },
  });
  await prisma.usageRecord.create({
    data: { tenantId: input.tenantId, provider: input.provider, operation: input.operation, organizationId: input.organizationId },
  });
}

export async function memberIds(tenantId: string) {
  const rows = await prisma.membership.findMany({ where: { tenantId }, include: { user: true } });
  return rows.map((row) => ({ id: row.user.id, name: row.user.name, email: row.user.email, role: row.role, membershipId: row.id }));
}

export async function assertAssignee(tenantId: string, userId: string) {
  const member = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!member) throw new ApiError(400, "Сотрудник не входит в это рабочее пространство", "assignee_invalid");
  return member;
}
