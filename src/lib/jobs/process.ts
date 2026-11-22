import "server-only";
import { prisma } from "../db";
import { ApiError, FatalJobError, RetryableError } from "../errors";
import { finishJob, failJob, reschedule } from "./queue";
import { refreshParserTask, runSync, submitParserTask } from "../services/parser";
import { runAnalysis } from "../services/analysis";
import { advanceSite, pullParserAudit, refreshPublish } from "../services/sites";
import { sendNextRecipient } from "../services/campaigns";
import { runRule } from "../services/automations";
import { runAgentTurn } from "../services/agent";
import { markQualifyFailed, runQualify } from "../services/hunt";
import { runSheetFull, runSheetPush } from "../services/sheets";
import { deliverWebhook } from "../services/projects";

type JobRow = { id: string; tenantId: string; type: string; payload: unknown; cancelRequested: boolean };

function payload(job: JobRow): Record<string, unknown> {
  return job.payload && typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {};
}

export async function processJob(job: JobRow) {
  if (job.cancelRequested) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "cancelled", finishedAt: new Date() } });
    return;
  }
  const data = payload(job);
  try {
    if (job.type === "parser.submit") await submitParserTask(String(data.parserTaskId));
    else if (job.type === "parser.poll") {
      const existing = await prisma.parserTask.findUnique({ where: { id: String(data.parserTaskId) } });
      if (!existing) throw new FatalJobError("Задача поиска не найдена");
      await refreshParserTask(existing.tenantId, existing.id);
      const fresh = await prisma.parserTask.findUnique({ where: { id: existing.id } });
      if (fresh && !["completed", "failed", "cancelled"].includes(fresh.status)) throw new RetryableError("Поиск ещё выполняется.", 5000);
      if (fresh?.status === "completed" && !fresh.syncedAt) throw new RetryableError("Результаты ещё сохраняются.", 4000);
    }
    else if (job.type === "parser.sync") await runSync(String(data.syncRunId));
    else if (job.type === "analysis.run") await runAnalysis(String(data.reportId));
    else if (job.type === "site.generate") await advanceSite(String(data.siteProjectId));
    else if (job.type === "site.qa") await pullParserAudit(String(data.auditId));
    else if (job.type === "site.publish") await refreshPublish(String(data.siteProjectId));
    else if (job.type === "campaign.send") {
      const step = await sendNextRecipient(String(data.campaignId));
      if (step && "continue" in step && step.continue) {
        await reschedule(job.id, 2000);
        return;
      }
    }
    else if (job.type === "automation.run") await runRule(String(data.ruleId), (data.payload as Record<string, unknown>) ?? {}, Boolean(data.dryRun));
    else if (job.type === "agent.turn") await runAgentTurn(String(data.threadId));
    else if (job.type === "hunt.qualify") {
      try {
        await runQualify(String(data.organizationId), job.tenantId);
      } catch (error) {
        // Карточка не должна навсегда остаться «в очереди»: помечаем сбой, если повторов больше не будет.
        const current = await prisma.job.findUnique({ where: { id: job.id }, select: { attempts: true, maxAttempts: true } });
        const lastTry = !current || current.attempts >= current.maxAttempts;
        if (!(error instanceof RetryableError) || lastTry) await markQualifyFailed(String(data.organizationId), error instanceof Error ? error.message : "Ошибка квалификации");
        throw error;
      }
    }
    // Пространство берётся из самой задачи, а не из payload: задача не может тронуть чужие данные.
    else if (job.type === "sheets.push") await runSheetPush(String(data.kind), String(data.id), job.tenantId);
    else if (job.type === "sheets.full") await runSheetFull(job.tenantId);
    else if (job.type === "project.webhook") await deliverWebhook(String(data.projectId), String(data.event), job.tenantId);
    else throw new FatalJobError(`Неизвестный тип задачи ${job.type}`);
    await finishJob(job.id, { ok: true });
  } catch (error) {
    if (error instanceof RetryableError) {
      if (error.consumeAttempt) await failJob(job.id, error, error.delayMs);
      else await reschedule(job.id, error.delayMs);
      return;
    }
    if (error instanceof FatalJobError || (error instanceof ApiError && error.status < 500)) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "failed", error: error.message.slice(0, 500), finishedAt: new Date() },
      });
      return;
    }
    await failJob(job.id, error);
  }
}
