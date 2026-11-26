import "server-only";
import { prisma } from "../db";
import { ApiError, FatalJobError, RetryableError } from "../errors";
import { enqueueJob, finishJob, failJob, reschedule } from "./queue";
import { logEvent } from "../log";
import { sendAlert } from "../services/alerts";
import { kickSearchQueue, refreshParserTask, runSync, submitParserTask, tickSearchQueue } from "../services/parser";
import { runAnalysis } from "../services/analysis";
import { advanceSite, pullParserAudit, refreshPublish } from "../services/sites";
import { sendNextRecipient } from "../services/campaigns";
import { runRule } from "../services/automations";
import { runAgentTurn } from "../services/agent";
import { markQualifyFailed, runQualify } from "../services/hunt";
import { runSheetFull, runSheetPush } from "../services/sheets";
import { deliverWebhook } from "../services/projects";
import { generateProposal } from "../services/proposals";

const JOB_LABEL: Record<string, string> = {
  "parser.submit": "запуск поиска в парсере",
  "parser.poll": "сбор результатов парсера",
  "parser.queue": "очередь поисков",
  "parser.sync": "синхронизация с парсером",
  "analysis.run": "AI-анализ",
  "site.generate": "генерация сайта",
  "site.qa": "аудит сайта",
  "site.publish": "публикация сайта",
  "campaign.send": "рассылка",
  "automation.run": "автоматизация",
  "agent.turn": "ответ агента",
  "hunt.qualify": "AI-скоринг карточки",
  "sheets.push": "запись в Google Таблицу",
  "sheets.full": "выгрузка в Google Таблицу",
  "hunt.proposal": "КП-презентация",
  "project.webhook": "отправка проекта по API",
};

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
  const started = Date.now();
  const base = { job: job.id, type: job.type, tenant: job.tenantId };
  try {
    if (job.type === "parser.submit") {
      try {
        const pending = await prisma.parserTask.findUnique({ where: { id: String(data.parserTaskId) }, select: { status: true, type: true, dispatchedAt: true, externalId: true, tenantId: true } });
        // Поиск отменили, пока он ждал очереди парсера, — не запускаем платный сбор.
        if (!pending || ["cancelled", "failed"].includes(pending.status)) {
          await finishJob(job.id, { skipped: pending?.status ?? "missing" });
          return;
        }
        // S4: сбор, который ещё ждёт очереди LeadFlow, отправляет только очередь — иначе два сбора разом и 429.
        if (pending.type === "organizations.collect" && !pending.dispatchedAt && !pending.externalId) {
          await kickSearchQueue(pending.tenantId);
          await finishJob(job.id, { queued: true });
          return;
        }
        const submitted = await submitParserTask(String(data.parserTaskId));
        // Отложенный запуск тоже должен опрашивать результат — иначе поиск навсегда остаётся «в очереди».
        await enqueueJob({ tenantId: submitted.tenantId, type: "parser.poll", payload: { parserTaskId: submitted.id }, idempotencyKey: `poll:${submitted.id}` });
      } catch (error) {
        const task = await prisma.parserTask.findUnique({ where: { id: String(data.parserTaskId) }, select: { createdAt: true, dispatchedAt: true } });
        // Время ожидания в очереди LeadFlow не считаем — отсчёт с момента, когда сбор отдан парсеру.
        const tooOld = task && Date.now() - (task.dispatchedAt ?? task.createdAt).getTime() > 3 * 60 * 60 * 1000;
        if (error instanceof RetryableError && !tooOld) {
          // Парсер просит подождать (429) или недоступен — ждём, попытки не тратим: поиск не должен умереть из-за очереди.
          await reschedule(job.id, Math.max(30_000, error.delayMs));
          logEvent("parser.submit_wait", { ...base, delayMs: Math.max(30_000, error.delayMs), reason: error.message });
          return;
        }
        const reason = tooOld ? "Парсер не принял задачу за 3 часа — запустите поиск снова" : error instanceof Error ? error.message : "Парсер не принял задачу";
        await prisma.parserTask.updateMany({ where: { id: String(data.parserTaskId), status: "queued" }, data: { status: "failed", error: reason.slice(0, 300) } });
        await kickSearchQueue(job.tenantId);
        throw error instanceof RetryableError ? new FatalJobError(reason) : error;
      }
    }
    else if (job.type === "parser.poll") {
      const existing = await prisma.parserTask.findUnique({ where: { id: String(data.parserTaskId) } });
      if (!existing) throw new FatalJobError("Задача поиска не найдена");
      // Поиск не должен навсегда остаться «идёт»: сбор дольше 6 часов или окончательная ошибка → «failed» с причиной.
      const tooLong = Date.now() - (existing.dispatchedAt ?? existing.createdAt).getTime() > 6 * 60 * 60 * 1000;
      if (tooLong && !["completed", "failed", "cancelled"].includes(existing.status)) {
        await prisma.parserTask.update({ where: { id: existing.id }, data: { status: "failed", error: "Сбор не завершился за 6 часов — запустите поиск снова." } });
        logEvent("parser.task_timeout", { ...base, task: existing.id }, "warn");
        await kickSearchQueue(existing.tenantId);
        throw new FatalJobError("Сбор не завершился за 6 часов");
      }
      try {
        await refreshParserTask(existing.tenantId, existing.id);
      } catch (error) {
        const current = await prisma.job.findUnique({ where: { id: job.id }, select: { attempts: true, maxAttempts: true } });
        const lastTry = !current || current.attempts >= current.maxAttempts;
        const fatal = error instanceof FatalJobError || (error instanceof ApiError && error.status < 500);
        if (fatal || (lastTry && !(error instanceof RetryableError && !error.consumeAttempt))) {
          const reason = error instanceof ApiError ? error.message : "Не удалось получить результаты сбора";
          await prisma.parserTask.update({ where: { id: existing.id }, data: { status: "failed", error: `${reason}. Запустите поиск снова.`.slice(0, 300) } });
          logEvent("parser.task_failed", { ...base, task: existing.id, error: reason }, "error");
          await kickSearchQueue(existing.tenantId);
        }
        throw error;
      }
      const fresh = await prisma.parserTask.findUnique({ where: { id: existing.id } });
      // Сбор закончился (или ушёл на повтор и снова занял место) — очередь сама решит, отдавать ли следующего.
      if (fresh && fresh.type === "organizations.collect" && !["queued", "running"].includes(fresh.status)) await kickSearchQueue(fresh.tenantId);
      // Массовый сбор идёт минутами (паузы против капчи) — опрашиваем реже.
      if (fresh && !["completed", "failed", "cancelled"].includes(fresh.status)) throw new RetryableError("Поиск ещё выполняется.", fresh.type === "organizations.collect" ? 15000 : 5000);
      if (fresh?.status === "completed" && !fresh.syncedAt) throw new RetryableError("Результаты ещё сохраняются.", 4000);
    }
    else if (job.type === "parser.queue") {
      const tick = await tickSearchQueue(String(data.parserTaskId));
      if (!tick.done) throw new RetryableError("Поиск ждёт очереди парсера.", 20_000);
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
    else if (job.type === "automation.run") await runRule(String(data.ruleId), (data.payload as Record<string, unknown>) ?? {}, Boolean(data.dryRun), job.tenantId);
    else if (job.type === "agent.turn") await runAgentTurn(String(data.threadId));
    else if (job.type === "hunt.qualify") {
      try {
        await runQualify(String(data.organizationId), job.tenantId, data.siteScan === false ? { siteScan: false } : {});
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
    else if (job.type === "hunt.proposal") await generateProposal(String(data.outreachId), job.tenantId);
    else if (job.type === "project.webhook") await deliverWebhook(String(data.projectId), String(data.event), job.tenantId);
    else throw new FatalJobError(`Неизвестный тип задачи ${job.type}`);
    await finishJob(job.id, { ok: true });
    logEvent("job.done", { ...base, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof ApiError ? error.code : error instanceof RetryableError ? "retry" : error instanceof FatalJobError ? "fatal" : "error";
    // «Поиск ещё идёт» — штатное ожидание, а не сбой: в журнал не пишем.
    const routine = error instanceof RetryableError && !error.consumeAttempt && ["parser.poll", "parser.queue"].includes(job.type);
    if (!routine) logEvent("job.failed", { ...base, ms: Date.now() - started, code, error: message.slice(0, 300) }, error instanceof RetryableError ? "warn" : "error");
    if (!(error instanceof RetryableError)) {
      // Окончательный сбой задачи — в Telegram, привязанный к этому пространству.
      await sendAlert(job.tenantId, `Сбой задачи «${JOB_LABEL[job.type] ?? job.type}»`, message, { key: `job:${job.type}` });
    }
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
