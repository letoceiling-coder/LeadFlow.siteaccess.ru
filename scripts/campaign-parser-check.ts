import { prisma } from "../src/lib/db";
import { requireReady } from "../src/lib/integrations/config";
import { ParserClient, asTask } from "../src/lib/integrations/parser";

async function main() {
  const tasks = await prisma.parserTask.findMany({ orderBy: { createdAt: "desc" }, take: 4 });
  const ready = await requireReady(tasks[0].tenantId, "parser", "Проверка");
  const client = new ParserClient(String(ready.config.baseUrl), ready.secrets.apiKey);
  for (const task of tasks) {
    if (!task.externalId) continue;
    const body = asTask(await client.getTask(task.externalId));
    const result = body.result && typeof body.result === "object" ? (body.result as Record<string, unknown>) : {};
    console.log(JSON.stringify({
      city: (task.input as { city?: string }).city,
      category: (task.input as { category?: string }).category,
      status: body.status,
      progress: body.progress,
      query: result.query ?? null,
      partial: result.partial ?? null,
      deduplicatedCount: result.deduplicatedCount ?? null,
      organizations: Array.isArray(result.organizations) ? result.organizations.length : null,
      error: body.error ?? null,
    }));
  }
  await prisma.$disconnect();
}

main();
