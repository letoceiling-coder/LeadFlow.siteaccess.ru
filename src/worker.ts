import { prisma } from "./lib/db";
import { claimJob, recoverStaleJobs } from "./lib/jobs/queue";
import { processJob } from "./lib/jobs/process";
import { safeLog } from "./lib/errors";
import { logEvent } from "./lib/log";

let started = false;
const STALE_CHECK_MS = 60 * 1000;

async function recover(startedBefore?: Date) {
  try {
    const result = await recoverStaleJobs(startedBefore);
    if (result.requeued || result.dead) logEvent("worker.recovered_jobs", { ...result, onStart: Boolean(startedBefore) }, "warn");
  } catch (error) {
    safeLog("worker.recover", error);
  }
}

export async function startWorker() {
  if (started) return;
  started = true;
  // Всё, что числится «running» до старта, брошено прошлым процессом.
  await recover(new Date());
  let lastStaleCheck = Date.now();
  for (;;) {
    try {
      await prisma.workerHeartbeat.upsert({
        where: { id: "default" },
        update: { seenAt: new Date(), info: "worker" },
        create: { id: "default", seenAt: new Date(), info: "worker" },
      });
      if (Date.now() - lastStaleCheck > STALE_CHECK_MS) {
        lastStaleCheck = Date.now();
        await recover();
      }
      const job = await claimJob();
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      await processJob(job);
    } catch (error) {
      safeLog("worker", error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("/src/worker.ts") || entry?.endsWith("/src/worker.js")) {
  startWorker();
}
