import { prisma } from "../src/lib/db";
import { requireReady } from "../src/lib/integrations/config";
import { agentModel, completeTools } from "../src/lib/integrations/openrouter";

async function main() {
  const member = await prisma.membership.findFirst({ where: { role: "OWNER" } });
  if (!member) throw new Error("нет владельца");
  const ready = await requireReady(member.tenantId, "openrouter", "Проверка");
  try {
    const result = await completeTools({
      baseUrl: String(ready.config.baseUrl),
      apiKey: ready.secrets.apiKey,
      model: agentModel(),
      messages: [{ role: "user", content: "Ответь одним словом: работает" }],
      tools: [{ name: "ping", description: "Ничего не делает", parameters: { type: "object", properties: {}, required: [] } }],
    });
    console.log("ok", JSON.stringify(result.message).slice(0, 180));
  } catch (error) {
    console.log("fail", error instanceof Error ? error.message : "ошибка");
  }
  await prisma.$disconnect();
}

main();
