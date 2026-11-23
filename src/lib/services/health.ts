import "server-only";
import { prisma } from "../db";
import { resolveIntegration } from "../integrations/config";
import { ParserClient } from "../integrations/parser";

/** «Состояние системы»: всё, что нужно, чтобы понять, почему лента пустая, не открывая сервер. */

let workersCache: { at: number; tenantId: string; value: { online: number; busy: number; names: string[] } | { error: string } } | null = null;

async function parserWorkers(tenantId: string) {
  if (workersCache && workersCache.tenantId === tenantId && Date.now() - workersCache.at < 60_000) return workersCache.value;
  let value: { online: number; busy: number; names: string[] } | { error: string };
  try {
    const integration = await resolveIntegration(tenantId, "parser");
    if (!integration.configured) value = { error: "Parser API не настроен" };
    else {
      const body = (await Promise.race([
        new ParserClient(String(integration.config.baseUrl), integration.secrets.apiKey).workers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ])) as { workers?: { id: string; connected?: boolean; busy?: boolean }[] };
      const list = (body.workers ?? []).filter((item) => item.connected !== false);
      value = { online: list.length, busy: list.filter((item) => item.busy).length, names: list.map((item) => item.id) };
    }
  } catch {
    value = { error: "Parser API не ответил" };
  }
  workersCache = { at: Date.now(), tenantId, value };
  return value;
}

/** Страховка цепочки: поиск принят парсером, но опроса результата нет (сбой, рестарт) — ставим опрос. */
export async function reviveSearches(tenantId: string) {
  const { enqueueJob } = await import("../jobs/queue");
  const stuck = await prisma.parserTask.findMany({ where: { tenantId, externalId: { not: null }, status: { in: ["queued", "running"] } }, select: { id: true } });
  let revived = 0;
  for (const task of stuck) {
    const live = await prisma.job.findFirst({ where: { tenantId, type: "parser.poll", status: { in: ["queued", "running"] }, payload: { path: ["parserTaskId"], equals: task.id } }, select: { id: true } });
    if (live) continue;
    await enqueueJob({ tenantId, type: "parser.poll", payload: { parserTaskId: task.id }, idempotencyKey: `poll:${task.id}:revive:${Date.now()}` });
    revived += 1;
  }
  return revived;
}

export async function systemHealth(tenantId: string) {
  await reviveSearches(tenantId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [heartbeat, jobs, failures, lastTask, ai, sheets, parser, workers] = await Promise.all([
    prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
    prisma.job.groupBy({ by: ["type", "status"], where: { tenantId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.job.findMany({ where: { tenantId, status: { in: ["failed", "dead"] }, finishedAt: { gte: since } }, orderBy: { finishedAt: "desc" }, take: 8, select: { type: true, error: true, finishedAt: true, attempts: true } }),
    prisma.parserTask.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, input: true, organizationCount: true, createdAt: true, error: true } }),
    resolveIntegration(tenantId, "openrouter"),
    resolveIntegration(tenantId, "sheets"),
    resolveIntegration(tenantId, "parser"),
    parserWorkers(tenantId),
  ]);
  const workerAgeSec = heartbeat ? Math.round((Date.now() - heartbeat.seenAt.getTime()) / 1000) : null;

  // Качество последнего поиска: сколько просили, сколько пришло, у скольких нет названия и отзывов.
  let lastSearch: null | { category: string; city: string; requested: number; received: number; unnamed: number; withReviews: number; status: string; at: Date; error: string | null } = null;
  if (lastTask) {
    const input = (lastTask.input ?? {}) as { city?: string; category?: string; maxResults?: number };
    const orgs = await prisma.organization.findMany({
      where: { tenantId, category: input.category ?? undefined, city: input.city ?? undefined, updatedAt: { gte: new Date(lastTask.createdAt.getTime() - 60_000) } },
      select: { name: true, reviewCount: true },
      take: 500,
    });
    lastSearch = {
      category: input.category ?? "",
      city: input.city ?? "",
      requested: input.maxResults ?? 0,
      received: lastTask.organizationCount ?? 0,
      unnamed: orgs.filter((item) => !item.name || item.name.toLowerCase() === "unknown").length,
      withReviews: orgs.filter((item) => (item.reviewCount ?? 0) > 0).length,
      status: lastTask.status,
      at: lastTask.createdAt,
      error: lastTask.error,
    };
  }

  const checks = [
    { key: "worker", label: "Обработчик задач", ok: workerAgeSec != null && workerAgeSec < 90, detail: workerAgeSec == null ? "ни разу не выходил на связь" : workerAgeSec < 90 ? "на связи" : `молчит ${Math.round(workerAgeSec / 60)} мин` },
    { key: "parser", label: "Парсер", ok: parser.status === "connected" && "online" in workers && workers.online > 0, detail: "error" in workers ? workers.error : `${workers.online} обработчик(а) онлайн${workers.busy ? `, заняты ${workers.busy}` : ""}${workers.names.length ? ` · ${workers.names.join(", ")}` : ""}` },
    { key: "ai", label: "AI-скоринг (OpenRouter)", ok: ai.status === "connected", detail: ai.status === "connected" ? "подключён" : ai.lastError ?? "не подключён — скоринг по данным источника" },
    { key: "sheets", label: "Google Таблица", ok: sheets.status === "connected", optional: true, detail: sheets.status === "connected" ? "подключена" : sheets.configured ? sheets.lastError ?? "не проверена" : "не подключена" },
  ];
  return {
    checks,
    jobs: jobs.map((item) => ({ type: item.type, status: item.status, count: item._count._all })),
    failures: failures.map((item) => ({ type: item.type, error: item.error, at: item.finishedAt, attempts: item.attempts })),
    lastSearch,
  };
}
