import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, publicErrorMessage } from "../errors";
import { buildSiteBrief } from "../domain/brief";
import { requireReady } from "../integrations/config";
import { StudioClient } from "../integrations/studio";
import { ParserClient } from "../integrations/parser";
import { enqueueJob } from "../jobs/queue";
import { assertBudget, audit, getSettings, moveLead, notify, recordCost } from "./common";

function studio(integration: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  return new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey);
}

export async function createSite(tenantId: string, userId: string, input: {
  organizationId: string;
  siteType: string;
  language: string;
  style?: string;
  pages: string[];
  wishes?: string;
  confirm?: boolean;
}) {
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, tenantId }, include: { contacts: true } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  if (organization.isDemo) throw new ApiError(409, "Для демонстрационной карточки проект в Studio не создаётся.", "demo_blocked");
  const settings = await getSettings(tenantId);
  if (settings.confirm.bulkDemo && !input.confirm) {
    throw new ApiError(409, "Создание демо-сайта нужно подтвердить: оно расходует квоту Studio.", "confirm_required");
  }
  await assertBudget(tenantId, settings.ai.maxCostPerBriefUsd);
  const active = await prisma.siteProject.findFirst({
    where: { tenantId, organizationId: organization.id, status: { in: ["queued", "building", "waiting_user", "preview_ready", "qa_running"] } },
  });
  if (active) return { project: active, existing: true };
  await requireReady(tenantId, "studio", "Создание сайта");
  const brief = buildSiteBrief(
    {
      name: organization.name,
      category: organization.category,
      city: organization.city,
      region: organization.region,
      address: organization.address,
      phones: organization.contacts.filter((item) => item.type === "phone").map((item) => item.value),
      emails: organization.contacts.filter((item) => item.type === "email").map((item) => item.value),
      socials: organization.contacts.filter((item) => item.type === "social").map((item) => item.value),
      website: organization.website,
      websiteStatus: organization.websiteStatus,
      rating: organization.rating,
      reviewCount: organization.reviewCount,
      services: organization.services,
      features: organization.features,
      hours: organization.hours,
      description: organization.description,
      sourceUrl: organization.sourceUrl,
    },
    { siteType: input.siteType, language: input.language, style: input.style ?? null, pages: input.pages, wishes: input.wishes ?? null },
  );
  const project = await prisma.siteProject.create({
    data: {
      tenantId,
      organizationId: organization.id,
      name: `${organization.name} — демо`,
      siteType: input.siteType,
      language: input.language,
      style: input.style,
      pages: input.pages,
      wishes: input.wishes,
      brief,
      status: "queued",
      isDemo: true,
      visibility: "unpublished",
      createdById: userId,
    },
  });
  await enqueueJob({ tenantId, type: "site.generate", payload: { siteProjectId: project.id }, idempotencyKey: `site:${project.id}` });
  await moveLead(tenantId, organization.id, "demo_creating", userId);
  await audit({ tenantId, actorId: userId, action: "site.create", entityType: "site", entityId: project.id });
  return { project, existing: false };
}

export async function advanceSite(siteProjectId: string) {
  const project = await prisma.siteProject.findUnique({ where: { id: siteProjectId }, include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!project) return;
  if (["waiting_user", "preview_ready", "qa_passed", "approved", "published", "cancelled"].includes(project.status)) return;
  const integration = await requireReady(project.tenantId, "studio", "Генерация сайта");
  const client = studio(integration);
  let studioProjectId = project.studioProjectId;
  if (!studioProjectId) {
    const created = await client.createProject(
      { name: project.name, description: "Демонстрационный макет. Не является официальным сайтом организации." },
      project.id.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120),
    );
    const id = (created.body as { id?: string }).id;
    if (!id) throw new ApiError(502, "Studio не вернул id проекта", "studio_shape");
    studioProjectId = id;
    await prisma.siteProject.update({ where: { id: project.id }, data: { studioProjectId, status: "building" } });
  }
  let run = project.runs[0];
  if (!run || ["failed", "cancelled"].includes(run.status)) {
    const started = await client.startAgent(studioProjectId, project.brief || "Собери демонстрационный сайт по фактам.", "build", `agent-${project.id}-${Date.now()}`.slice(0, 120));
    const taskId = (started.body as { taskId?: string }).taskId;
    if (!taskId) throw new ApiError(502, "Studio не вернул задачу агента", "studio_shape");
    run = await prisma.siteGenerationRun.create({
      data: { tenantId: project.tenantId, siteProjectId: project.id, studioTaskId: taskId, status: "running", prompt: project.brief },
    });
  }
  if (!run.studioTaskId) return;
  const polled = await client.getAgentTask(run.studioTaskId, 0);
  const task = polled.body as { status?: string; state?: string; error?: string; reply?: { text?: string; meta?: { kind?: string } } };
  await prisma.siteGenerationRun.update({
    where: { id: run.id },
    data: {
      status: task.status || run.status,
      state: task.state,
      replyText: task.reply?.text,
      replyMeta: task.reply?.meta ? (task.reply.meta as Prisma.InputJsonValue) : undefined,
      error: task.error,
      finishedAt: task.status && !["queued", "running"].includes(task.status) ? new Date() : null,
    },
  });
  if (task.status === "queued" || task.status === "running") {
    await prisma.siteProject.update({ where: { id: project.id }, data: { status: "building", error: null } });
    const { RetryableError } = await import("../errors");
    throw new RetryableError("Агент ещё собирает сайт.", 8000);
  }
  if (task.status === "failed") {
    await prisma.siteProject.update({ where: { id: project.id }, data: { status: "failed", error: task.error || "Агент завершился с ошибкой" } });
    await notify(project.tenantId, "Демо не собрано", task.error || "Ошибка агента", `/sites/${project.id}`);
    return;
  }
  const kind = task.reply?.meta?.kind;
  if (kind === "questions" || kind === "plan" || kind === "confirm") {
    await prisma.siteProject.update({ where: { id: project.id }, data: { status: "waiting_user" } });
    await notify(project.tenantId, "Агент ждёт ответ", project.name, `/sites/${project.id}`);
    return;
  }
  await prisma.siteProject.update({ where: { id: project.id }, data: { status: "preview_ready", error: null } });
  await moveLead(project.tenantId, project.organizationId, "demo_ready");
  await recordCost({ tenantId: project.tenantId, provider: "studio", operation: "site.generate", amountUsd: null, organizationId: project.organizationId, refType: "site", refId: project.id });
  await notify(project.tenantId, "Демо готово к просмотру", project.name, `/sites/${project.id}`);
}

export async function replyToAgent(tenantId: string, userId: string, siteId: string, text: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project?.studioProjectId) throw new ApiError(409, "Проект Studio ещё не создан", "not_ready");
  const integration = await requireReady(tenantId, "studio", "Ответ агенту");
  const started = await studio(integration).startAgent(project.studioProjectId, text, "build", `reply-${siteId}-${Date.now()}`.slice(0, 120));
  const taskId = (started.body as { taskId?: string }).taskId;
  await prisma.siteGenerationRun.create({
    data: { tenantId, siteProjectId: project.id, studioTaskId: taskId, status: "running", prompt: text },
  });
  await prisma.siteProject.update({ where: { id: project.id }, data: { status: "building" } });
  await enqueueJob({ tenantId, type: "site.generate", payload: { siteProjectId: project.id }, idempotencyKey: `site-reply:${siteId}:${Date.now()}` });
  await audit({ tenantId, actorId: userId, action: "site.reply", entityType: "site", entityId: siteId });
  return { taskId };
}

export async function publicShare(tenantId: string, userId: string, siteId: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project?.studioProjectId) throw new ApiError(409, "Сначала дождитесь создания проекта", "not_ready");
  if (project.publicUrl && project.visibility === "public" && project.status === "published") return { url: project.publicUrl, public: true as const };
  const integration = await requireReady(tenantId, "studio", "Публичная ссылка");
  const scopes = integration.scopes;
  if (scopes.length && !scopes.includes("publish")) throw new ApiError(403, "У ключа Studio нет права publish.", "studio_scope");
  const client = studio(integration);
  const started = (await client.publish(project.studioProjectId, "public")).body as { state?: string; url?: string; error?: string };
  let state = started.state || "building";
  let url = started.url || "";
  const begun = Date.now();
  while (state !== "published" && state !== "failed" && Date.now() - begun < 45000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = (await client.publishStatus(project.studioProjectId)).body as { state?: string; url?: string; error?: string };
    state = status.state || state;
    url = status.url || url;
    if (state === "failed") throw new ApiError(502, "Публикация сайта не удалась.", "publish_failed");
  }
  if (!url) throw new ApiError(502, "Studio не вернул публичную ссылку", "publish_missing");
  await prisma.siteProject.update({
    where: { id: project.id },
    data: { publicUrl: url, visibility: "public", status: state === "published" ? "published" : "publish_requested", error: null },
  });
  await audit({ tenantId, actorId: userId, action: "site.publish", entityType: "site", entityId: siteId, meta: { visibility: "public" } });
  return { url, public: true as const };
}

export async function freshPreview(tenantId: string, siteId: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project?.studioProjectId) throw new ApiError(409, "Сначала дождитесь создания проекта", "not_ready");
  const integration = await requireReady(tenantId, "studio", "Превью");
  const result = await studio(integration).previewUrl(project.studioProjectId);
  const url = (result.body as { url?: string }).url;
  if (!url) throw new ApiError(502, "Studio не вернул ссылку превью", "preview_missing");
  await prisma.siteProject.update({ where: { id: project.id }, data: { previewUrl: url, previewFetchedAt: new Date() } });
  return { url, expiresInSeconds: 120 };
}

export async function runQa(tenantId: string, userId: string, siteId: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project?.studioProjectId) throw new ApiError(409, "Проверять пока нечего", "not_ready");
  const integration = await requireReady(tenantId, "studio", "Проверка сайта");
  const client = studio(integration);
  const qa = await client.qaLatest(project.studioProjectId);
  const body = qa.body as { score?: number; issues?: { severity?: string; title?: string }[]; summary?: string };
  const issues = Array.isArray(body?.issues) ? body.issues : [];
  const critical = issues.filter((issue) => issue.severity === "critical" || issue.severity === "major").length;
  const auditRow = await prisma.siteAudit.create({
    data: {
      tenantId,
      siteProjectId: project.id,
      source: "studio",
      status: "completed",
      score: typeof body?.score === "number" ? body.score : null,
      criticalCount: critical,
      warningCount: issues.length - critical,
      result: (body ?? {}) as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  const status = critical > 0 ? "qa_failed" : "qa_passed";
  await prisma.siteProject.update({
    where: { id: project.id },
    data: { status, qaScore: typeof body?.score === "number" ? body.score : null, qaSummary: body?.summary ?? null, criticalCount: critical },
  });
  if (critical === 0) await moveLead(tenantId, project.organizationId, "awaiting_review", userId);
  await audit({ tenantId, actorId: userId, action: "site.qa", entityType: "site", entityId: siteId });
  return { audit: auditRow, status };
}

export async function requestParserAudit(tenantId: string, userId: string, siteId: string) {
  const preview = await freshPreview(tenantId, siteId);
  const integration = await requireReady(tenantId, "parser", "Аудит сайта");
  const parser = new ParserClient(String(integration.config.baseUrl), integration.secrets.apiKey);
  const project = await prisma.siteProject.findFirstOrThrow({ where: { id: siteId, tenantId } });
  const created = await parser.createTask(
    { type: "site.audit", input: { url: preview.url, devices: ["desktop", "mobile"], maxClicks: 10, checkLinks: true, aiReport: false } },
    `audit-${siteId}-${Date.now()}`.slice(0, 120),
  );
  const externalId = (created as { id?: string }).id;
  const row = await prisma.siteAudit.create({
    data: { tenantId, siteProjectId: project.id, source: "parser", externalTaskId: externalId, status: "queued" },
  });
  await enqueueJob({ tenantId, type: "site.qa", payload: { auditId: row.id }, idempotencyKey: `qa:${row.id}` });
  await audit({ tenantId, actorId: userId, action: "site.audit.parser", entityType: "site", entityId: siteId });
  return row;
}

export async function pullParserAudit(auditId: string) {
  const row = await prisma.siteAudit.findUnique({ where: { id: auditId }, include: { siteProject: true } });
  if (!row?.externalTaskId || row.status === "completed") return;
  const integration = await requireReady(row.tenantId, "parser", "Аудит сайта");
  const parser = new ParserClient(String(integration.config.baseUrl), integration.secrets.apiKey);
  const task = (await parser.getTask(row.externalTaskId)) as { status?: string; result?: { score?: number; issues?: { severity?: string }[]; summary?: string }; error?: string };
  if (task.status === "queued" || task.status === "running") {
    const { RetryableError } = await import("../errors");
    throw new RetryableError("Аудит ещё выполняется.", 8000);
  }
  const issues = task.result?.issues ?? [];
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  await prisma.siteAudit.update({
    where: { id: row.id },
    data: {
      status: task.status || "failed",
      score: task.result?.score ?? null,
      criticalCount: critical,
      result: (task.result ?? { error: task.error }) as Prisma.InputJsonValue,
      error: task.error,
      finishedAt: new Date(),
    },
  });
  if (task.status === "completed" && critical > 0) {
    await prisma.siteProject.update({ where: { id: row.siteProjectId }, data: { status: "qa_failed", criticalCount: critical, qaScore: task.result?.score ?? null } });
  }
}

export async function fixSite(tenantId: string, userId: string, siteId: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId }, include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!project?.studioProjectId) throw new ApiError(409, "Проект ещё не создан", "not_ready");
  const auditRow = project.audits[0];
  if (!auditRow?.result) throw new ApiError(409, "Сначала выполните проверку", "qa_required");
  const issues = ((auditRow.result as { issues?: { severity?: string; title?: string; fix?: string }[] }).issues ?? [])
    .filter((issue) => issue.severity === "critical" || issue.severity === "major")
    .slice(0, 12);
  const text = [
    "Исправь только подтверждённые проблемы проверки. Не выдумывай новые факты об организации.",
    ...issues.map((issue, index) => `${index + 1}. ${issue.title ?? "Проблема"}. ${issue.fix ?? ""}`),
  ].join("\n");
  return replyToAgent(tenantId, userId, siteId, text);
}

export async function approveSite(tenantId: string, userId: string, siteId: string, comment?: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project) throw new ApiError(404, "Проект не найден", "not_found");
  if (project.criticalCount > 0 || project.status === "qa_failed") {
    throw new ApiError(409, "Нельзя подтвердить демо, пока есть критические ошибки проверки.", "qa_blocked");
  }
  await prisma.siteApproval.create({ data: { siteProjectId: project.id, userId, decision: "approved", comment } });
  await prisma.siteProject.update({ where: { id: project.id }, data: { status: "approved", assigneeId: userId } });
  await moveLead(tenantId, project.organizationId, "ready_to_contact", userId);
  await audit({ tenantId, actorId: userId, action: "site.approve", entityType: "site", entityId: siteId });
  return { ok: true };
}

export async function publishSite(tenantId: string, userId: string, siteId: string, visibility: "private" | "public") {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project?.studioProjectId) throw new ApiError(409, "Проект ещё не создан", "not_ready");
  if (project.criticalCount > 0) throw new ApiError(409, "Публикация остановлена: есть критические ошибки.", "qa_blocked");
  if (project.status !== "approved" && project.status !== "publish_requested") {
    throw new ApiError(409, "Сначала сотрудник должен подтвердить готовность демо.", "approval_required");
  }
  const integration = await requireReady(tenantId, "studio", "Публикация");
  const scopes = integration.scopes;
  if (scopes.length && !scopes.includes("publish")) {
    throw new ApiError(403, "У ключа Studio нет права publish.", "studio_scope");
  }
  await studio(integration).publish(project.studioProjectId, visibility);
  await prisma.siteApproval.create({ data: { siteProjectId: project.id, userId, decision: "publish", comment: visibility } });
  await prisma.siteProject.update({ where: { id: project.id }, data: { status: "publish_requested", visibility } });
  await enqueueJob({ tenantId, type: "site.publish", payload: { siteProjectId: project.id }, idempotencyKey: `publish:${project.id}:${Date.now()}` });
  await audit({ tenantId, actorId: userId, action: "site.publish", entityType: "site", entityId: siteId, meta: { visibility } });
  return { status: "publish_requested" };
}

export async function refreshPublish(siteProjectId: string) {
  const project = await prisma.siteProject.findUnique({ where: { id: siteProjectId } });
  if (!project?.studioProjectId) return;
  const integration = await requireReady(project.tenantId, "studio", "Статус публикации");
  const status = (await studio(integration).publishStatus(project.studioProjectId)).body as { state?: string; url?: string; error?: string };
  if (status.state === "building") {
    const { RetryableError } = await import("../errors");
    throw new RetryableError("Публикация ещё собирается.", 10000);
  }
  await prisma.siteProject.update({
    where: { id: project.id },
    data: {
      status: status.state === "published" ? "published" : status.state === "failed" ? "failed" : project.status,
      error: status.error || null,
      publicUrl: status.url || project.publicUrl,
      visibility: status.state === "published" ? project.visibility : project.visibility,
    },
  });
}

export async function removeSite(tenantId: string, userId: string, siteId: string) {
  const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
  if (!project) throw new ApiError(404, "Проект не найден", "not_found");
  if (project.studioProjectId) {
    try {
      const integration = await requireReady(tenantId, "studio", "Удаление проекта");
      await studio(integration).deleteProject(project.studioProjectId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  await prisma.siteProject.delete({ where: { id: project.id } });
  await audit({ tenantId, actorId: userId, action: "site.delete", entityType: "site", entityId: siteId });
}

export function siteError(error: unknown) {
  return publicErrorMessage(error);
}
