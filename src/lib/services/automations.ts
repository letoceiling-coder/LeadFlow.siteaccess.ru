import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { evaluateConditions, validateAutomation, type ConditionGroup } from "../domain/automation";
import { enqueueJob } from "../jobs/queue";
import { notify } from "./common";
import { scoreOrganization } from "./organizations";

export async function emitTrigger(tenantId: string, trigger: string, payload: Record<string, unknown>) {
  const rules = await prisma.automationRule.findMany({ where: { tenantId, active: true, trigger } });
  for (const rule of rules) {
    await enqueueJob({
      tenantId,
      type: "automation.run",
      payload: { ruleId: rule.id, payload, dryRun: false },
      idempotencyKey: `auto:${rule.id}:${trigger}:${String(payload.organizationId ?? payload.leadId ?? "none")}:${Date.now()}`,
    });
  }
}

export async function runRule(ruleId: string, payload: Record<string, unknown>, dryRun: boolean, tenantId: string) {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, tenantId } });
  if (!rule) return;
  if (!rule.active && !dryRun) return;
  const validation = validateAutomation({
    trigger: rule.trigger,
    actions: rule.actions as { type: string }[],
    intervalMinutes: rule.intervalMinutes,
  });
  const run = await prisma.automationRun.create({
    data: { ruleId, tenantId: rule.tenantId, status: "running", dryRun, input: payload as Prisma.InputJsonValue },
  });
  if (validation) {
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: "failed", error: validation, finishedAt: new Date() } });
    return;
  }
  const matched = evaluateConditions(rule.conditions as ConditionGroup, payload);
  const planned: unknown[] = [];
  if (matched) {
    for (const action of rule.actions as { type: string; params?: Record<string, unknown> }[]) {
      planned.push(action);
      if (dryRun) continue;
      const organizationId = typeof payload.organizationId === "string" ? payload.organizationId : undefined;
      if (action.type === "compute_score" && organizationId) await scoreOrganization(rule.tenantId, organizationId);
      if (action.type === "enqueue_analysis" && organizationId) {
        const { enqueueAnalysis } = await import("./analysis");
        await enqueueAnalysis(rule.tenantId, "automation", [organizationId], true);
      }
      if (action.type === "notify") {
        await notify(rule.tenantId, rule.name, String(action.params?.text || "Сработало правило автоматизации"));
      }
      if (action.type === "create_task" && organizationId) {
        await prisma.crmTask.create({
          data: {
            tenantId: rule.tenantId,
            title: String(action.params?.title || rule.name),
            organizationId,
            createdById: "automation",
            status: "open",
          },
        });
      }
      if (action.type === "suggest_demo") {
        await notify(rule.tenantId, "Можно подготовить демо", "Правило предлагает создать сайт. Автоматически проект не создаётся.", organizationId ? `/organizations/${organizationId}` : "/sites");
      }
      if (action.type === "prepare_draft") {
        await notify(rule.tenantId, "Можно подготовить сообщение", "Черновик нужно создать и подтвердить вручную.", organizationId ? `/organizations/${organizationId}` : "/communications");
      }
      if (action.type === "move_stage" && organizationId && typeof action.params?.stageKey === "string") {
        const { moveLead } = await import("./common");
        if (action.params.stageKey !== "do_not_contact" && action.params.stageKey !== "won") {
          await moveLead(rule.tenantId, organizationId, action.params.stageKey);
        }
      }
    }
  }
  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status: "completed", output: { matched, planned } as Prisma.InputJsonValue, finishedAt: new Date() },
  });
}
