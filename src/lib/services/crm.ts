import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { activity, assertAssignee, moveLead } from "./common";

export async function board(tenantId: string) {
  const stages = await prisma.pipelineStage.findMany({
    where: { tenantId },
    orderBy: { position: "asc" },
    include: {
      leads: {
        where: { organization: { isDemo: false } },
        include: { organization: { select: { id: true, name: true, city: true, leadScore: true, category: true } } },
        orderBy: { updatedAt: "desc" },
        take: 40,
      },
    },
  });
  return stages.map((stage) => ({
    id: stage.id,
    key: stage.key,
    name: stage.name,
    position: stage.position,
    leads: stage.leads.map((lead) => ({
      id: lead.id,
      organizationId: lead.organizationId,
      name: lead.organization.name,
      city: lead.organization.city,
      category: lead.organization.category,
      score: lead.organization.leadScore,
      value: lead.value ? Number(lead.value) : null,
      assigneeId: lead.assigneeId,
      nextActionAt: lead.nextActionAt,
    })),
  }));
}

export async function updateLead(tenantId: string, leadId: string, actorId: string, input: { stageKey?: string; assigneeId?: string | null; value?: number | null; nextActionAt?: string | null; lostReason?: string | null }) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw new ApiError(404, "Лид не найден", "not_found");
  if (input.assigneeId) await assertAssignee(tenantId, input.assigneeId);
  if (input.stageKey) await moveLead(tenantId, lead.organizationId, input.stageKey, actorId);
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId,
      value: input.value === undefined ? undefined : input.value,
      nextActionAt: input.nextActionAt === undefined ? undefined : input.nextActionAt ? new Date(input.nextActionAt) : null,
      lostReason: input.lostReason === undefined ? undefined : input.lostReason,
    },
  });
  if (input.assigneeId !== undefined) {
    await prisma.organization.update({ where: { id: lead.organizationId }, data: { assigneeId: input.assigneeId } });
  }
  return updated;
}

export async function createDeal(tenantId: string, actorId: string, input: { organizationId: string; title: string; value?: number | null }) {
  const lead = await prisma.lead.findFirst({ where: { organizationId: input.organizationId, tenantId }, include: { stage: true } });
  if (!lead) throw new ApiError(404, "Сначала организация должна быть в воронке", "not_found");
  const deal = await prisma.deal.create({
    data: {
      tenantId,
      leadId: lead.id,
      organizationId: input.organizationId,
      stageId: lead.stageId,
      title: input.title,
      value: input.value ?? null,
      assigneeId: lead.assigneeId,
    },
  });
  await activity({ tenantId, organizationId: input.organizationId, leadId: lead.id, actorId, type: "deal", message: `Создана сделка «${input.title}»` });
  return deal;
}

export async function updateDeal(tenantId: string, id: string, actorId: string, input: { status?: "open" | "won" | "lost"; value?: number | null; title?: string }) {
  const deal = await prisma.deal.findFirst({ where: { id, tenantId } });
  if (!deal) throw new ApiError(404, "Сделка не найдена", "not_found");
  const updated = await prisma.deal.update({
    where: { id },
    data: {
      status: input.status,
      value: input.value === undefined ? undefined : input.value,
      title: input.title,
    },
  });
  if (input.status === "won") await moveLead(tenantId, deal.organizationId, "won", actorId);
  if (input.status === "lost") await moveLead(tenantId, deal.organizationId, "lost", actorId);
  if (input.status === "won") {
    const { emitTrigger } = await import("./automations");
    await emitTrigger(tenantId, "deal.won", { organizationId: deal.organizationId, dealId: deal.id });
  }
  return updated;
}

export async function listTasks(tenantId: string, userId: string, role: string) {
  return prisma.crmTask.findMany({
    where: { tenantId, ...(role === "OPERATOR" ? { assigneeId: userId } : {}) },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
  });
}

export async function createTask(tenantId: string, userId: string, input: { title: string; description?: string; dueAt?: string; assigneeId?: string; organizationId?: string; leadId?: string }) {
  if (input.assigneeId) await assertAssignee(tenantId, input.assigneeId);
  if (input.organizationId) {
    const org = await prisma.organization.findFirst({ where: { id: input.organizationId, tenantId } });
    if (!org) throw new ApiError(404, "Организация не найдена", "not_found");
  }
  return prisma.crmTask.create({
    data: {
      tenantId,
      title: input.title,
      description: input.description,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assigneeId: input.assigneeId,
      organizationId: input.organizationId,
      leadId: input.leadId,
      createdById: userId,
    },
  });
}

export function decimal(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) return null;
  return Number(value);
}
