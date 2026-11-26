import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError, publicErrorMessage, safeLog } from "../errors";
import { needsLargeConfirm, type searchSchema } from "../domain/schemas";
import { collectStatusOf, mapParserOrganization } from "../domain/parser-map";
import { ParserClient, asTask } from "../integrations/parser";
import { requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { isWaiting, pickNext, queueInfo, sourcesOf } from "../domain/search-queue";
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
  // Без настроенного парсера поиск даже не встаёт в очередь.
  await requireReady(tenantId, "parser", "Поиск организаций");
  // Массовый сбор (organizations/collect): все поля карточки — мессенджеры, прайс, отзывы, ИНН — и до 500 карточек за раз.
  const keyBase = ["collect", normalize(input.city), normalize(input.category), normalize(input.searchQuery), input.maxResults, input.includePhotos].join(":");
  if (!input.force) {
    const existing = await prisma.parserTask.findFirst({
      where: {
        tenantId,
        OR: [{ idempotencyKey: keyBase }, { idempotencyKey: { startsWith: `${keyBase}:run:` } }],
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        status: { in: ["queued", "running", "completed"] },
        // Сбор, который ничего не нашёл, не должен сутки блокировать повтор.
        NOT: { status: "completed", organizationCount: 0 },
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
      // Ключ всегда уникальный: повтор того же поиска через сутки или после сбоя не должен падать на ограничении базы.
      idempotencyKey: `${keyBase}:${input.force ? "retry" : "run"}:${Date.now()}`,
      createdById: userId,
    },
  });
  await audit({ tenantId, actorId: userId, action: "parser.search", entityType: "parser_task", entityId: task.id, meta: { city: input.city, category: input.category } });
  // Парсер тянет один сбор за раз: поиск встаёт в очередь LeadFlow и уходит в парсер, когда место свободно.
  // Страховка: задача-«часы» раз в 20 с проверяет очередь, даже если событие завершения предыдущего сбора потерялось.
  await enqueueJob({ tenantId, type: "parser.queue", payload: { parserTaskId: task.id }, delayMs: 20_000, idempotencyKey: `queue:${task.id}`, maxAttempts: 50 });
  await pumpSearchQueue(tenantId);
  const fresh = await prisma.parserTask.findUniqueOrThrow({ where: { id: task.id } });
  if (fresh.status === "failed") throw new ApiError(502, fresh.error || "Парсер не принял поиск.", "parser_failed");
  const info = queueInfo(await openCollects(tenantId)).get(task.id);
  return { task: fresh, duplicate: false, queued: Boolean(info && info.state === "waiting"), position: info?.position ?? null };
}

function openCollects(tenantId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.parserTask.findMany({
    where: { tenantId, type: "organizations.collect", status: { in: ["queued", "running"] } },
    select: { id: true, type: true, status: true, externalId: true, dispatchedAt: true, createdAt: true, input: true },
  });
}

/**
 * Отдаёт парсеру следующий сбор из очереди, если место свободно. Безопасно вызывать откуда угодно и сколько угодно раз:
 * место занимается под блокировкой базы, поэтому два параллельных вызова не отправят два сбора и не получат 429.
 */
export async function pumpSearchQueue(tenantId: string) {
  for (let round = 0; round < 10; round += 1) {
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`search-queue:${tenantId}`}))`;
      const next = pickNext(await openCollects(tenantId, tx));
      if (!next) return null;
      await tx.parserTask.update({ where: { id: next.id }, data: { dispatchedAt: new Date() } });
      return next.id;
    });
    if (!claimed) return null;
    try {
      const sent = await submitParserTask(claimed);
      await enqueueJob({ tenantId, type: "parser.poll", payload: { parserTaskId: sent.id }, idempotencyKey: `poll:${sent.id}` });
      return claimed;
    } catch (error) {
      if (error instanceof RetryableError) {
        // Парсер занят (429) или недоступен: место остаётся за этим сбором, повторная отправка — отдельной задачей.
        await enqueueJob({ tenantId, type: "parser.submit", payload: { parserTaskId: claimed }, delayMs: error.delayMs, idempotencyKey: `submit:${claimed}` });
        return claimed;
      }
      // Окончательная ошибка — сбор помечен, место свободно, пробуем следующего в очереди.
      await prisma.parserTask.updateMany({ where: { id: claimed, status: { in: ["queued", "running"] } }, data: { status: "failed", error: publicErrorMessage(error), completedAt: new Date() } });
      safeLog("parser.queue.submit", error);
    }
  }
  return null;
}

/** Мягкий вызов очереди для мест, где сбой очереди не должен ломать основное действие. */
export async function kickSearchQueue(tenantId: string) {
  try {
    await pumpSearchQueue(tenantId);
  } catch (error) {
    safeLog("parser.queue", error);
  }
}

/** Длиннее суток в очереди LeadFlow не ждём: что-то сломалось, пусть человек решит сам. */
const WAIT_LIMIT_MS = 24 * 60 * 60 * 1000;

/** Задача-«часы» одного поиска: пока он ждёт очереди, раз в 20 с толкает очередь. */
export async function tickSearchQueue(taskId: string) {
  const task = await prisma.parserTask.findUnique({ where: { id: taskId } });
  if (!task || !isWaiting(task)) return { done: true };
  if (Date.now() - task.createdAt.getTime() > WAIT_LIMIT_MS) {
    await prisma.parserTask.updateMany({ where: { id: task.id, status: "queued", dispatchedAt: null }, data: { status: "failed", error: "Поиск сутки ждал очереди парсера — запустите его снова.", completedAt: new Date() } });
    return { done: true };
  }
  await pumpSearchQueue(task.tenantId);
  const fresh = await prisma.parserTask.findUnique({ where: { id: taskId } });
  return { done: !fresh || !isWaiting(fresh) };
}

/** Очередь и история поисков для экрана: строки поиска + место в очереди и источники. */
export async function searchQueue(tenantId: string, limit = 20) {
  const { searches } = await import("./hunt");
  const rows = await searches(tenantId, limit);
  const info = queueInfo(await openCollects(tenantId));
  const inputs = await prisma.parserTask.findMany({ where: { tenantId, id: { in: rows.map((row) => row.id) } }, select: { id: true, input: true } });
  const sources = new Map(inputs.map((row) => [row.id, sourcesOf(row.input)]));
  return rows.map((row) => ({ ...row, queue: info.get(row.id) ?? null, sources: sources.get(row.id) ?? ["maps", "sites"] }));
}

/** Убрать поиск из очереди: ждущий или идущий сначала отменяется, потом запись удаляется. Карточки остаются в базе. */
export async function removeFromQueue(tenantId: string, id: string, actorId: string) {
  const task = await prisma.parserTask.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (!task) throw new ApiError(404, "Поиск не найден", "not_found");
  if (["queued", "running"].includes(task.status)) await cancelSearch(tenantId, id, actorId);
  await prisma.parserTask.deleteMany({ where: { id, tenantId } });
  return { ok: true };
}

export async function submitParserTask(taskId: string, ready?: Awaited<ReturnType<typeof requireReady>>) {
  const task = await prisma.parserTask.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiError(404, "Задача поиска не найдена", "not_found");
  if (task.externalId || ["cancelled", "failed"].includes(task.status)) return task;
  const integration = ready ?? (await requireReady(task.tenantId, "parser", "Поиск организаций"));
  const input = task.input as Record<string, unknown>;
  if (task.type === "organizations.collect") {
    const attempts = Array.isArray(input.attempts) ? (input.attempts as { workerId?: string }[]) : [];
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
      `${task.id.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 110)}${attempts.length ? `:r${attempts.length}` : ""}`,
      attempts.map((item) => item.workerId).filter((id): id is string => Boolean(id)),
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
    const st = (await clientFrom(integration).collectStatus(task.externalId)) as { status?: string; stage?: string; stageLabel?: string; progress?: number; message?: string; counters?: Record<string, number>; counts?: Record<string, number>; workerId?: string; error?: string | null; etaSeconds?: number | null; eta?: unknown };
    const status = collectStatusOf(st.status, task.status);
    // Яндекс иногда на несколько минут отдаёт одному серверу парсера пустую выдачу. Такой сбор — не «готово, 0»,
    // а повод отдать задачу другому серверу; после нескольких пустых попыток — понятная ошибка.
    const collected = st.counts?.collected ?? st.counters?.collected;
    if (status === "completed" && collected === 0) {
      const empty = await retryEmptyCollect(task, st.workerId ?? null, st.error ?? st.message ?? null);
      return empty;
    }
    // updateMany с условием: параллельная отмена не перетирается устаревшим опросом.
    await prisma.parserTask.updateMany({
      where: { id: task.id, status: { notIn: ["cancelled"] } },
      data: {
        status,
        progress: st.progress ?? task.progress,
        error: st.error ? String(st.error).slice(0, 500) : null,
        resultSummary: { stage: st.stage ?? null, stageLabel: st.stageLabel ?? null, message: st.message ?? null, counters: (st.counters ?? null) as Prisma.InputJsonValue, eta: (st.etaSeconds ?? null) as number | null },
        completedAt: status === "completed" ? new Date() : task.completedAt,
      },
    });
    const updatedCollect = await prisma.parserTask.findUniqueOrThrow({ where: { id } });
    if (updatedCollect.status === "completed" && !updatedCollect.syncedAt) await syncTaskOrganizations(updatedCollect.id);
    if (["completed", "failed"].includes(updatedCollect.status) && !["completed", "failed"].includes(task.status)) {
      const input = updatedCollect.input as { city?: string; category?: string };
      const done = await prisma.parserTask.findUniqueOrThrow({ where: { id } });
      await notify(tenantId, "Охота: сбор", updatedCollect.status === "completed" ? `${input.category ?? "Поиск"}, ${input.city ?? ""}: собрано ${done.organizationCount ?? 0}. Карточки оцениваются.` : `${input.category ?? "Поиск"}, ${input.city ?? ""}: сбор не удался — ${updatedCollect.error ?? "ошибка парсера"}.`, "/hunt");
    }
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

export const EMPTY_COLLECT_ATTEMPTS = 3;

async function retryEmptyCollect(task: Awaited<ReturnType<typeof prisma.parserTask.findUniqueOrThrow>>, workerId: string | null, reason: string | null) {
  const input = (task.input ?? {}) as Record<string, unknown>;
  const attempts = [...(Array.isArray(input.attempts) ? (input.attempts as Record<string, unknown>[]) : []), { workerId, externalId: task.externalId, at: new Date().toISOString(), reason: reason ? String(reason).slice(0, 200) : null }];
  const meta = input as { city?: string; category?: string };
  if (attempts.length >= EMPTY_COLLECT_ATTEMPTS) {
    const error = `Яндекс Карты не отдали выдачу ни одному серверу парсера (${attempts.length} попытки). Это временно — повторите поиск через 15–30 минут.`;
    await prisma.parserTask.updateMany({
      where: { id: task.id, status: { notIn: ["cancelled"] } },
      data: { status: "failed", error, input: { ...input, attempts } as Prisma.InputJsonValue, completedAt: new Date(), organizationCount: 0 },
    });
    await notify(task.tenantId, "Охота: сбор", `${meta.category ?? "Поиск"}, ${meta.city ?? ""}: ${error}`, "/hunt");
    return prisma.parserTask.findUniqueOrThrow({ where: { id: task.id } });
  }
  const moved = await prisma.parserTask.updateMany({
    where: { id: task.id, externalId: task.externalId, status: { notIn: ["cancelled"] } },
    data: {
      externalId: null,
      status: "queued",
      progress: 0,
      error: null,
      input: { ...input, attempts } as Prisma.InputJsonValue,
      resultSummary: { stage: "retry", stageLabel: `Выдача на сервере ${workerId ?? "парсера"} пустая — пробуем другой сервер (попытка ${attempts.length + 1} из ${EMPTY_COLLECT_ATTEMPTS})`, message: null, counters: null, eta: null },
    },
  });
  if (!moved.count) return prisma.parserTask.findUniqueOrThrow({ where: { id: task.id } });
  try {
    await submitParserTask(task.id);
  } catch (error) {
    if (!(error instanceof RetryableError)) {
      await prisma.parserTask.update({ where: { id: task.id }, data: { status: "failed", error: publicErrorMessage(error) } });
      throw error;
    }
    // Парсер занят: задача остаётся в очереди, повторная отправка — отдельной задачей.
    await enqueueJob({ tenantId: task.tenantId, type: "parser.submit", payload: { parserTaskId: task.id }, delayMs: error.delayMs, idempotencyKey: `submit:${task.id}:r${attempts.length}` });
  }
  return prisma.parserTask.findUniqueOrThrow({ where: { id: task.id } });
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
    const input = task.input as { maxResults?: number; need?: number };
    const requested = Number(input.maxResults ?? input.need ?? 0);
    // Источник «Сайты» выключен — карточки оцениваются по данным карт, сайты не открываем (быстрее).
    const siteScan = sourcesOf(task.input).includes("sites");
    await autoQualifyNew(task.tenantId, [...seen], { explicit: task.type === "organizations.collect", max: requested || seen.size, ...(siteScan ? {} : { siteScan: false }) });
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
  // Место в парсере освободилось — следующий в очереди уходит сразу.
  await kickSearchQueue(tenantId);
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
