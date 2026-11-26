/**
 * Проверка радара на реальных данных — ТОЛЬКО ЧТЕНИЕ. В базу ничего не пишет, в Telegram ничего не отправляет,
 * в чаты не вступает. Ищет открытые чаты по словам, читает последние 50 сообщений, прогоняет фильтр
 * со словоформами и классификацию моделью, печатает итог.
 *
 * Запуск в контейнере app (рядом src и node_modules):
 *   npx tsx --require /tmp/allow.cjs scripts/radar-check.ts
 * Переменные: RADAR_QUERIES="аренда склада;склады москва", RADAR_CHATS="@chat1,@chat2", RADAR_AI=0 — без модели.
 */
import { prisma } from "../src/lib/db";
import { isReady, requireReady } from "../src/lib/integrations/config";
import { messengerReader } from "../src/lib/integrations/messengers";
import { completeJson } from "../src/lib/integrations/openrouter";
import { resolveTaskModel } from "../src/lib/domain/models";
import { buildRadarPrompt, keywordFilter, radarResultSchema, readablePeer, type RadarResult } from "../src/lib/domain/radar";

const KEYWORDS = ["аренда склада", "ищу склад", "склад в аренду", "ответственное хранение", "помещение под производство", "снять склад", "нужен склад", "складское помещение", "аренда помещения"];
const MINUS = ["продам", "вакансия", "требуется кладовщик", "грузчик"];
const TARGET = "люди и компании, которые сами ищут склад, складское или производственное помещение в аренду, или ответственное хранение";

async function main() {
  const integration = await prisma.integration.findFirst({ where: { provider: "parser" }, select: { tenantId: true } });
  if (!integration) throw new Error("Нет интеграции parser");
  const tenantId = integration.tenantId;
  const reader = await messengerReader(tenantId);
  const queries = (process.env.RADAR_QUERIES ?? "аренда склада;склады москва;коммерческая недвижимость аренда;ответственное хранение").split(";").map((item) => item.trim()).filter(Boolean);
  const chats = new Map<string, { title: string; type: string; members: number | null }>();
  for (const ref of (process.env.RADAR_CHATS ?? "").split(",").map((item) => item.trim().replace(/^@/, "")).filter(Boolean)) {
    const peer = await reader.resolve(ref);
    if (readablePeer(peer)) chats.set(peer.username!, { title: peer.title, type: peer.type, members: peer.members ?? null });
    else console.log(`пропуск ${ref}: ${peer.type}, не открытый чат`);
  }
  for (const query of queries) {
    if (chats.size >= 6) break;
    const found = (await reader.search(query, 20)).filter(readablePeer);
    console.log(`поиск «${query}»: открытых ${found.length} — ${found.slice(0, 8).map((peer) => `@${peer.username} (${peer.type}, ${peer.members ?? "?"})`).join(", ")}`);
    // Запросы пишут в группах; каналы — объявления владельцев.
    for (const peer of found.filter((item) => item.type !== "channel").slice(0, 2)) chats.set(peer.username!, { title: peer.title, type: peer.type, members: peer.members ?? null });
  }
  const useAi = process.env.RADAR_AI !== "0" && (await isReady(tenantId, "openrouter").catch(() => false));
  const ai = useAi ? await requireReady(tenantId, "openrouter", "Проверка радара") : null;
  const model = resolveTaskModel("analysis", process.env.AI_DEFAULT_MODEL);
  let totalRead = 0;
  let totalPassed = 0;
  let totalAi = 0;
  for (const [username, info] of [...chats].slice(0, 6)) {
    let history;
    try {
      history = await reader.history(username, { limit: 50 });
    } catch (error) {
      console.log(`\n@${username}: не читается — ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const texts = history.messages.filter((item) => item.text?.trim().length >= 12);
    const passed = texts.map((item) => ({ item, verdict: keywordFilter(item.text, KEYWORDS, MINUS) })).filter((row) => row.verdict.pass);
    const newest = texts[0]?.date ?? "—";
    totalRead += texts.length;
    totalPassed += passed.length;
    console.log(`\n@${username} «${info.title}» (${info.type}, ${info.members ?? "?"} уч.): прочитано ${texts.length}, прошли фильтр ${passed.length}, свежее ${newest}`);
    for (const { item, verdict } of passed.slice(0, 4)) {
      const line = item.text.replace(/\s+/g, " ").slice(0, 160);
      let result: RadarResult | null = null;
      if (ai) {
        const prompt = buildRadarPrompt({ projectName: "Брокер складов (проверка)", kind: "client", target: TARGET, keywords: KEYWORDS, chatTitle: info.title, text: item.text, rejected: [] });
        try {
          result = (await completeJson({ baseUrl: String(ai.config.baseUrl), apiKey: ai.secrets.apiKey, secrets: ai.secrets, model, system: prompt.system, user: prompt.user, schema: radarResultSchema, maxTokens: 500 })).data as RadarResult;
          totalAi += 1;
        } catch (error) {
          console.log(`   модель: ошибка ${error instanceof Error ? error.message : error}`);
        }
      }
      console.log(` • [${item.date.slice(0, 16)}] ${line}`);
      console.log(`   слова: ${verdict.matched.join(", ")}${result ? ` | ${result.intent} ${result.score}/100 | город ${result.city ?? "—"} район ${result.district ?? "—"} срок ${result.deadline ?? "—"} бюджет ${result.budget ?? "—"}` : ""}`);
      if (result?.summary) console.log(`   суть: ${result.summary}`);
      if (result?.reply) console.log(`   подсказка: ${result.reply}`);
    }
  }
  console.log(`\nИтого: чатов ${chats.size}, сообщений ${totalRead}, прошли фильтр ${totalPassed}, разобрано моделью ${totalAi} (${model}). Записей в базу: 0.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
