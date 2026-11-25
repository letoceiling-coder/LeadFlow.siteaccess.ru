import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { safeLog } from "../errors";

let queue: Queue | null = null;
let connection: IORedis | null = null;

function redisQueue() {
  if (!process.env.REDIS_URL) return null;
  if (!queue) {
    connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue("leadflow", { connection });
  }
  return queue;
}

export async function enqueueJob(input: {
  tenantId: string;
  type: string;
  payload: unknown;
  idempotencyKey?: string;
  delayMs?: number;
  maxAttempts?: number;
}) {
  if (input.idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing && !["failed", "dead", "cancelled"].includes(existing.status)) return existing;
    if (existing) {
      return prisma.job.update({
        where: { id: existing.id },
        data: {
          status: "queued",
          runAt: new Date(Date.now() + (input.delayMs ?? 0)),
          error: null,
          cancelRequested: false,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
    }
  }
  const job = await prisma.job.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 5,
      runAt: new Date(Date.now() + (input.delayMs ?? 0)),
    },
  });
  try {
    await redisQueue()?.add(input.type, { jobId: job.id }, { jobId: job.id, delay: input.delayMs });
  } catch (error) {
    safeLog("queue.redis", error);
  }
  return job;
}

export async function claimJob() {
  const studioBusy = await prisma.job.count({ where: { type: "site.generate", status: "running" } });
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        status: "queued",
        runAt: { lte: new Date() },
        cancelRequested: false,
        ...(studioBusy ? { type: { not: "site.generate" } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return null;
    const updated = await tx.job.updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (updated.count !== 1) return null;
    return tx.job.findUnique({ where: { id: job.id } });
  });
}

/** Сколько задача может числиться «running», прежде чем её сочтут брошенной. Генерация сайта идёт долго. */
const STALE_MS: Record<string, number> = { "site.generate": 90 * 60 * 1000 };
const STALE_DEFAULT_MS = 30 * 60 * 1000;

/**
 * Вернуть в очередь задачи, которые остались «running», потому что обработчик упал или перезапустился посреди работы
 * (например, при выкладке). Без этого они висят вечно: скоринг не завершается, а зависшая генерация сайта
 * не даёт брать следующие.
 *  • startedBefore — при старте обработчика: всё, что взято до старта, точно брошено (обработчик один и берёт задачи по одной).
 *  • без него — периодическая проверка по времени для каждого типа.
 * Попытки исчерпаны — задача помечается dead, как при обычной ошибке.
 */
export async function recoverStaleJobs(startedBefore?: Date) {
  const running = await prisma.job.findMany({ where: { status: "running" }, select: { id: true, type: true, startedAt: true, attempts: true, maxAttempts: true } });
  const now = Date.now();
  let requeued = 0;
  let dead = 0;
  for (const job of running) {
    const started = job.startedAt?.getTime() ?? 0;
    const stale = startedBefore ? started < startedBefore.getTime() : now - started > (STALE_MS[job.type] ?? STALE_DEFAULT_MS);
    if (!stale) continue;
    const message = "Обработчик остановился во время задачи";
    if (job.attempts >= job.maxAttempts) {
      const done = await prisma.job.updateMany({ where: { id: job.id, status: "running" }, data: { status: "dead", error: message, finishedAt: new Date() } });
      dead += done.count;
    } else {
      const done = await prisma.job.updateMany({ where: { id: job.id, status: "running" }, data: { status: "queued", error: message, runAt: new Date(), startedAt: null } });
      requeued += done.count;
    }
  }
  return { requeued, dead };
}

export async function finishJob(id: string, result: unknown) {
  await prisma.job.update({
    where: { id },
    data: { status: "completed", finishedAt: new Date(), result: result == null ? undefined : (result as Prisma.InputJsonValue), error: null },
  });
}

export async function reschedule(id: string, delayMs: number) {
  await prisma.job.update({
    where: { id },
    data: {
      status: "queued",
      runAt: new Date(Date.now() + delayMs),
      startedAt: null,
      attempts: { decrement: 1 },
      error: null,
    },
  });
}

export async function failJob(id: string, error: unknown, delayMs?: number) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return;
  const message = error instanceof Error ? error.message.slice(0, 500) : "Ошибка задачи";
  if (job.attempts >= job.maxAttempts) {
    await prisma.job.update({ where: { id }, data: { status: "dead", error: message, finishedAt: new Date() } });
    return;
  }
  const backoff = delayMs ?? Math.min(60000, 2000 * 2 ** job.attempts);
  await prisma.job.update({
    where: { id },
    data: { status: "queued", error: message, runAt: new Date(Date.now() + backoff), startedAt: null },
  });
}
