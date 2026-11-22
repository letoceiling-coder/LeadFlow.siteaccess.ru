import { prisma } from "./lib/db";
import { claimJob } from "./lib/jobs/queue";
import { processJob } from "./lib/jobs/process";
import { safeLog } from "./lib/errors";

let started = false;

export async function startWorker() {
  if (started) return;
  started = true;
  for (;;) {
    try {
      await prisma.workerHeartbeat.upsert({
        where: { id: "default" },
        update: { seenAt: new Date(), info: "worker" },
        create: { id: "default", seenAt: new Date(), info: "worker" },
      });
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
