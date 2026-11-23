import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError, publicErrorMessage, safeLog } from "../errors";
import { needsLargeConfirm, type searchSchema } from "../domain/schemas";
import { mapParserOrganization } from "../domain/parser-map";
import { ParserClient, asTask } from "../integrations/parser";
import { requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { audit, notify } from "./common";
import { upsertMapped } from "./organizations";
import type { z } from "zod";

type SearchInput = z.infer<typeof searchSchema>;

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function clientFrom(integration: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  return new ParserClient(String(integration.config.baseUrl), integration.secrets.apiKey);
}

export async function createSearch(tenantId: string, userId: string, input: SearchInput) {
  if (needsLargeConfirm(input.maxResults) && !input.confirmLarge) {
    throw new ApiError(409, "Поиск больше 200 организаций нужно подтвердить ещё раз.", "confirm_required");
  }
  const integration = await requireReady(tenantId, "parser", "Поиск организаций");
  // Массовый сбор (organizations/collect): все поля карточки — мессенджеры, прайс, отзывы, ИНН — и до 500 карточек за раз.
  const keyBase = ["collect", normalize(input.city), normalize(input.category), normalize(input.searchQuery), input.maxResults, input.includePhotos].join(":");
  if (!input.force) {
    const existing = await prisma.parserTask.findFirst({
      where: {
        tenantId,
        idempotencyKey: keyBase,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        status: { in: ["queued", "running", "completed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { task: existing, duplicate: true };
  }
  const task = await prisma.parserTask.create({
    data: {
      tenantId,
      type: "organizations.collect",
      input: input as unknown as Prisma.InputJsonValue,
      idempotencyKey: input.force ? `${keyBase}:retry:${Date.now()}` : keyBase,
      createdById: userId,
    },
  });
  try {
    await submitParserTask(task.id, integration);
  } catch (error) {
    if (error instanceof RetryableError) {
      await enqueueJob({ tenantId, type: "parser.submit", payload: { parserTaskId: task.id }, delayMs: error.delayMs, idempotencyKey: `submit:${task.id}` });
      return { task, duplicate: false, delayed: true };
    }
    await prisma.parserTask.update({ where: { id: task.id }, data: { status: "failed", error: publicErrorMessage(error) } });
    throw error;
  }
  await enqueueJob({ tenantId, type: "parser.poll", payload: { parserTaskId: task.id }, idempotencyKey: `poll:${task.id}` });
  await audit({ tenantId, actorId: userId, action: "parser.search", entityType: "parser_task", entityId: task.id, meta: { city: input.city, category: input.category } });
  return { task: await prisma.parserTask.findUniqueOrThrow({ where: { id: task.id } }), duplicate: false };
}

export async function submitParserTask(taskId: string, ready?: Awaited<ReturnType<typeof requireReady>>) {
  const task = await prisma.parserTask.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiError(404, "Задача поиска не найдена", "not_found");
  if (task.externalId) return task;
  const integration = ready ?? (await requireReady(task.tenantId, "parser", "Поиск организаций"));
  const input = task.input as Record<string, unknown>;
  if (task.type === "organizations.collect") {
    const body = (await clientFrom(integration).collect(
      {
        city: input.city,
        category: input.category,
        ...(input.searchQuery ? { query: input.searchQuery } : {}),
        count: input.maxResults,
        fields: "all_available",
        includePhotos: false,
        normalizeWithLlm: true,
        maxCostUsd: 0.3,
        priority: 5,
      },
      task.id.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120),
    )) as { taskId?: string; status?: { status?: string; progress?: number } };
    if (!body.taskId) throw new ApiError(502, "Парсер не вернул номер сбора.", "parser_shape");
    return prisma.parserTask.update({ where: { id: task.id }, data: { externalId: body.taskId, status: body.status?.status || "queued", progress: body.status?.progress ?? 0, startedAt: new Date() } });
  }
  const payload =
    task.type === "yandex.orgs"
      ? {
          type: "yandex.orgs",
          input: {
            city: input.city,
            category: input.category,
            ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
            maxResults: input.maxResults,
            includePhotos: Boolean(input.includePhotos),
            outputFormat: input.outputFormat === "csv" ? "csv" : "json",
          },
        }
      : { type: task.type, input: (input.remote as Record<string, unknown>) ?? input };
  const body = await clientFrom(integration).createTask(payload, task.id.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120));
  const remote = asTask(body);
  return prisma.parserTask.update({
    where: { id: task.id },
    data: {
      externalId: remote.id,
      status: remote.status || "queued",
      progress: remote.progress ?? 0,
      startedAt: remote.startedAt ? new Date(remote.startedAt) : undefined,
    },
  });
}

export async function refreshParserTask(tenantId: string, id: string) {
  const task = await prisma.parserTask.findFirst({ where: { id, tenantId } });
  if (!task) throw new ApiError(404, "Задача поиска не найдена", "not_found");
  if (!task.externalId) return task;
  if (["failed", "cancelled"].includes(task.status) || (task.status === "completed" && task.syncedAt)) return task;
  const integration = await requireReady(tenantId, "parser", "Обновление задачи");
  if (task.type === "organizations.collect") {
    const st = (await clientFrom(integration).collectStatus(task.externalId)) as { status?: string; stage?: string; stageLabel?: string; progress?: number; message?: string; counters?: Record<string, number>; error?: string | null; etaSeconds?: number | null; eta?: unknown };
    const status = st.status === "done" ? "completed" : st.status || task.status;
    const updatedCollect = await prisma.parserTask.update({
      where: { id: task.id },
      data: {
        status,
        progress: st.progress ?? task.progress,
        error: st.error ? String(st.error).slice(0, 500) : null,
        resultSummary: { stage: st.stage ?? null, stageLabel: st.stageLabel ?? null, message: st.message ?? null, counters: (st.counters ?? null) as Prisma.InputJsonValue, eta: (st.etaSeconds ?? null) as number | null },
        completedAt: status === "completed" ? new Date() : task.completedAt,
      },
    });
    if (updatedCollect.status === "completed" && !updatedCollect.syncedAt) await syncTaskOrganizations(updatedCollect.id);
    return prisma.parserTask.findUniqueOrThrow({ where: { id } });
  }
  const remote = asTask(await clientFrom(integration).getTask(task.externalId));
  const updated = await prisma.parserTask.update({
    where: { id: task.id },
    data: {
      status: remote.status || task.status,
      progress: remote.progress ?? task.progress,
      error: remote.error ? String(remote.error).slice(0, 500) : null,
      resultSummary: remote.result && typeof remote.result === "object" ? summarize(remote.result) : undefined,
      startedAt: remote.startedAt ? new Date(remote.startedAt) : task.startedAt,
      completedAt: remote.completedAt ? new Date(remote.completedAt) : task.completedAt,
    },
  });
  if (updated.status === "completed" && !updated.syncedAt) await syncTaskOrganizations(updated.id);
  if (["completed", "failed", "cancelled"].includes(updated.status)) {
    await notify(tenantId, "Поиск организаций", `Задача «${String((updated.input as { city?: string }).city ?? "")}» — ${updated.status}.`, "/search");
  }
  return prisma.parserTask.findUniqueOrThrow({ where: { id } });
}

function summarize(result: unknown): Prisma.InputJsonValue {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return {
    partial: record.partial ?? null,
    deduplicatedCount: record.deduplicatedCount ?? null,
    organizationCount: Array.isArray(record.organizations) ? record.organizations.length : null,
  };
}

export async function syncTaskOrganizations(taskId: string) {
  const task = await prisma.parserTask.findUnique({ where: { id: taskId } });
  if (!task || task.syncedAt) return { imported: 0, updated: 0 };
  const integration = await requireReady(task.tenantId, "parser", "Сохранение организаций");
  const parser = clientFrom(integration);
  let imported = 0;
  let updated = 0;
  const seen = new Set<string>();
  if (task.type === "organizations.collect" && task.externalId) {
    const result = (await parser.collectResult(task.externalId)) as { organizations?: unknown[]; plan?: { category?: string; city?: string } };
    const fallbackCategory = String((task.input as { category?: string }).category ?? result.plan?.category ?? "") || null;
    for (const item of result.organizations ?? []) {
      const mapped = mapParserOrganization(item);
      if (!mapped) continue;
      if (!mapped.category) mapped.category = mapped.categories[0] ?? fallbackCategory;
      const saved = await upsertMapped(task.tenantId, mapped);
      seen.add(saved.organization.id);
      if (saved.created) imported += 1;
      else updated += 1;
    }
  }
  const remote = task.externalId && task.type !== "organizations.collect" ? asTask(await parser.getTask(task.externalId)) : null;
  const inline = remote?.result && typeof remote.result === "object" ? (remote.result as { organizations?: unknown[] }).organizations ?? [] : [];
  for (const item of inline) {
    const mapped = mapParserOrganization(item);
    if (!mapped) continue;
    const saved = await upsertMapped(task.tenantId, mapped);
    seen.add(saved.organization.id);
    if (saved.created) imported += 1;
    else updated += 1;
  }
  if (task.externalId && task.type !== "organizations.collect") {
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ taskId: task.externalId, limit: "500", offset: String(offset), fields: "summary" });
      const body = (await parser.organizations(query)) as { items?: unknown[]; nextOffset?: number | null };
      for (const item of body.items ?? []) {
        const mapped = mapParserOrganization(item);
        if (!mapped) continue;
        const saved = await upsertMapped(task.tenantId, mapped);
        seen.add(saved.organization.id);
        if (saved.created) imported += 1;
        else updated += 1;
      }
      if (body.nextOffset == null) break;
      offset = body.nextOffset;
    }
  }
  // Квалификация — до отметки syncedAt и по всем увиденным карточкам: при повторе после сбоя ничего не теряется.
  try {
    const { autoQualifyNew } = await import("./hunt");
    await autoQualifyNew(task.tenantId, [...seen]);
  } catch (error) {
    safeLog("hunt.autoQualify", error);
  }
  await prisma.parserTask.update({
    where: { id: taskId },
      data: { organizationCount: seen.size, resultSummary: { imported, updated, unique: seen.size, orgIds: [...seen].slice(0, 500) }, syncedAt: new Date() },
  });
  return { imported, updated };
}

export async function cancelSearch(tenantId: string, id: string, actorId: string) {
  const task = await prisma.parserTask.findFirst({ where: { id, tenantId } });
  if (!task) throw new ApiError(404, "Задача поиска не найдена", "not_found");
  if (["completed", "failed", "cancelled"].includes(task.status)) {
    throw new ApiError(409, "Завершённую задачу отменить нельзя", "already_finished");
  }
  if (task.externalId) {
    const integration = await requireReady(tenantId, "parser", "Отмена задачи");
    try {
      await clientFrom(integration).cancelTask(task.externalId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
    }
  }
  const updated = await prisma.parserTask.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } });
  await audit({ tenantId, actorId, action: "parser.cancel", entityType: "parser_task", entityId: id });
  return updated;
}

export async function syncExisting(tenantId: string, userId: string, filters: Record<string, unknown>) {
  await requireReady(tenantId, "parser", "Синхронизация базы");
  const run = await prisma.syncRun.create({ data: { tenantId, status: "queued", filters: filters as Prisma.InputJsonValue } });
  await enqueueJob({ tenantId, type: "parser.sync", payload: { syncRunId: run.id }, idempotencyKey: `sync:${run.id}` });
  await audit({ tenantId, actorId: userId, action: "parser.sync", entityType: "sync_run", entityId: run.id });
  return run;
}

export async function runSync(syncRunId: string) {
  const run = await prisma.syncRun.findUnique({ where: { id: syncRunId } });
  if (!run) return;
  const integration = await requireReady(run.tenantId, "parser", "Синхронизация базы");
  const parser = clientFrom(integration);
  const filters = (run.filters ?? {}) as Record<string, unknown>;
  let offset = 0;
  let imported = 0;
  let updated = 0;
  const createdIds: string[] = [];
  try {
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: "500", offset: String(offset), fields: "summary" });
      for (const key of ["city", "category", "q", "hasPhone", "hasWebsite", "minRating", "minReviews", "updatedSince", "taskId"]) {
        if (filters[key] != null && filters[key] !== "") query.set(key, String(filters[key]));
      }
      const body = (await parser.organizations(query)) as { items?: unknown[]; nextOffset?: number | null };
      for (const item of body.items ?? []) {
        const mapped = mapParserOrganization(item);
        if (!mapped) continue;
        const saved = await upsertMapped(run.tenantId, mapped);
        if (saved.created) {
          imported += 1;
          createdIds.push(saved.organization.id);
        } else updated += 1;
      }
      if (body.nextOffset == null) break;
      offset = body.nextOffset;
    }
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: "completed", imported, updated, finishedAt: new Date() } });
    try {
      const { autoQualifyNew } = await import("./hunt");
      await autoQualifyNew(run.tenantId, createdIds);
    } catch (error) {
      safeLog("hunt.autoQualify", error);
    }
  } catch (error) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: "failed", imported, updated, error: publicErrorMessage(error), finishedAt: new Date() } });
    throw error;
  }
}
