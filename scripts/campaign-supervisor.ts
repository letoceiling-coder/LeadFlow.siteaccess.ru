import { appendFileSync, readFileSync, writeFileSync, existsSync } from "fs";
import { prisma } from "../src/lib/db";
import { postAgentMessage } from "../src/lib/services/agent";

const GOAL = 100;
const STAMP = "/tmp/campaign-stamp.txt";
const LOG = "/tmp/campaign.log";
const THREAD_FILE = "/tmp/campaign-thread.txt";
const CURSOR = "/tmp/campaign-cursor.txt";

const CITIES = [
  "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону",
  "Уфа", "Красноярск", "Воронеж", "Пермь", "Волгоград", "Краснодар", "Саратов", "Тюмень", "Тольятти", "Ижевск",
  "Барнаул", "Ульяновск", "Иркутск", "Хабаровск", "Ярославль", "Владивосток", "Махачкала", "Томск", "Оренбург", "Кемерово",
];
const SERVICE = ["автосервис", "салон красоты", "стоматология"];
const FOOD = ["кафе", "фастфуд"];

function log(line: string) {
  const text = `${new Date().toISOString()} ${line}\n`;
  appendFileSync(LOG, text);
  console.log(text.trim());
}

const QUERIES: Record<string, string[]> = {
  "автосервис": ["", "шиномонтаж", "кузовной ремонт", "автомойка", "автоэлектрик", "детейлинг", "сход-развал", "покраска автомобиля", "ремонт подвески", "замена масла"],
  "салон красоты": ["", "парикмахерская", "маникюр", "барбершоп", "косметология", "брови", "массаж"],
  "стоматология": ["", "стоматолог", "имплантация", "ортодонт", "детская стоматология"],
  "кафе": ["", "кофейня", "пиццерия", "суши", "кондитерская", "пекарня"],
  "фастфуд": ["", "бургер", "шаурма", "фастфуд", "быстрое питание", "столовая"],
};

function plan() {
  const pairs: { city: string; category: string; searchQuery: string }[] = [];
  CITIES.forEach((city, index) => {
    for (const category of [SERVICE[index % SERVICE.length], FOOD[index % FOOD.length]]) {
      for (const searchQuery of QUERIES[category]) pairs.push({ city, category, searchQuery });
    }
  });
  return pairs;
}

async function owner() {
  const row = await prisma.membership.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  if (!row) throw new Error("Нет владельца пространства");
  return row;
}

async function threadId(tenantId: string, userId: string, fresh: boolean) {
  if (!fresh && existsSync(THREAD_FILE)) {
    const id = readFileSync(THREAD_FILE, "utf8").trim();
    const found = await prisma.agentThread.findFirst({ where: { id, tenantId } });
    if (found && found.status !== "failed") return found.id;
  }
  const thread = await prisma.agentThread.create({ data: { tenantId, userId, title: "Объёмный тест: 100 сайтов и 100 КП" } });
  writeFileSync(THREAD_FILE, thread.id);
  return thread.id;
}

async function snapshot(tenantId: string, since: Date) {
  const [organizations, sites, published, building, waiting, preview, offers, pending] = await Promise.all([
    prisma.organization.count({ where: { tenantId, isDemo: false, createdAt: { gte: since } } }),
    prisma.siteProject.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.siteProject.count({ where: { tenantId, createdAt: { gte: since }, publicUrl: { not: null } } }),
    prisma.siteProject.count({ where: { tenantId, createdAt: { gte: since }, status: { in: ["queued", "building"] } } }),
    prisma.siteProject.findMany({ where: { tenantId, createdAt: { gte: since }, status: "waiting_user" }, select: { id: true, name: true }, take: 3 }),
    prisma.siteProject.findMany({
      where: { tenantId, createdAt: { gte: since }, status: { in: ["preview_ready", "qa_passed", "qa_failed", "approved"] }, publicUrl: null },
      select: { id: true, name: true, status: true },
      take: 5,
    }),
    prisma.conversation.findMany({
      where: { tenantId, channel: "email", createdAt: { gte: since }, messages: { some: { direction: "outbound", body: { contains: "Демонстрационный сайт:" } } } },
      select: { organizationId: true },
    }),
    prisma.parserTask.findMany({
      where: { tenantId, createdAt: { gte: since }, status: { in: ["queued", "running"] } },
      select: { id: true, status: true, input: true },
      take: 6,
    }),
  ]);
  const offerIds = new Set(offers.map((item) => item.organizationId));
  const readyForOffer = await prisma.siteProject.findMany({
    where: { tenantId, createdAt: { gte: since }, publicUrl: { not: null }, organization: { optOut: null, isDemo: false } },
    select: { organizationId: true, organization: { select: { name: true, city: true } } },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
  const offerQueue = readyForOffer.filter((item) => !offerIds.has(item.organizationId)).slice(0, 5);
  const candidates = await prisma.organization.findMany({
    where: {
      tenantId,
      isDemo: false,
      websiteStatus: { in: ["NO_WEBSITE", "SOCIAL_ONLY", "AGGREGATOR_ONLY"] },
      contacts: { some: { type: { in: ["email", "social"] } } },
      sites: { none: {} },
      optOut: null,
      createdAt: { gte: since },
    },
    select: { id: true, name: true, city: true, category: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return {
    organizations,
    sites,
    published,
    building,
    waiting,
    preview,
    offers: offerIds.size,
    pending,
    offerQueue,
    candidates,
  };
}

function searchTask(batch: { city: string; category: string; searchQuery: string }[]) {
  const lines = batch.map((item, index) => `${index + 1}. Город ${item.city}. category=${item.category}. searchQuery=${item.searchQuery || "пусто"}.`).join("\n");
  return [
    "Продолжай сбор организаций. Сейчас только поиск.",
    "По каждому пункту вызови start_search один раз: need=50, maxResults=50, searchQuery из пункта. Если написано «пусто», searchQuery не передавай. Фильтр noWebsite не ставь: нужны все найденные карточки.",
    "parsing_coverage не вызывай. Если start_search вернёт duplicate, это нормально: переходи к следующему пункту и не подменяй запрос прошлым поиском.",
    "wait_search не вызывай. Фоновый опрос сам сохранит карточки. Не выдумывай организации.",
    "Сайты в этом шаге не создавай.",
    lines,
  ].join("\n");
}

function siteTask(rows: { id: string; name: string; city: string | null; category: string | null }[]) {
  const lines = rows.map((item) => `${item.id} | ${item.name} | ${item.city || "город не указан"} | ${item.category || "направление не указано"}`).join("\n");
  return [
    "Создай демо-сайты только для этих организаций, у которых нет своего сайта и есть почта или соцсеть. Вызови start_sites одним вызовом.",
    "Промпт длинный: премиальный сайт, характер направления и город. Для кафе, фастфуда и магазинов продуктов опиши витрину, меню или каталог, оформление заказа и расчёт доставки. Цены блюд, часы работы и сумму доставки пиши только если они уже есть в карточке. Если их нет, разделы остаются без сумм и без выдуманного графика: стоимость уточняется при заказе. Отзывы, лицензии и награды не выдумывай. Контакты бери только из карточки.",
    "Для остальных услуг опиши запись, состав работ и обращение без цен.",
    lines,
  ].join("\n");
}

async function main() {
  const member = await owner();
  const since = existsSync(STAMP) ? new Date(readFileSync(STAMP, "utf8").trim()) : new Date();
  if (!existsSync(STAMP)) writeFileSync(STAMP, since.toISOString());
  const pairs = plan();
  log(`старт tenant=${member.tenantId} с ${since.toISOString()}`);
  for (;;) {
    const state = await snapshot(member.tenantId, since);
    const minutes = Math.round((Date.now() - since.getTime()) / 60000);
    log(`минута ${minutes}: организаций ${state.organizations}, сайтов ${state.sites}, с публичной ссылкой ${state.published}, собирается ${state.building}, КП ${state.offers}, поиск в работе ${state.pending.length}`);
    if (state.published >= GOAL && state.offers >= GOAL) {
      log(`готово за ${minutes} мин: ${state.published} сайтов и ${state.offers} КП`);
      break;
    }
    const previousId = existsSync(THREAD_FILE) ? readFileSync(THREAD_FILE, "utf8").trim() : "";
    const previous = previousId ? await prisma.agentThread.findFirst({ where: { id: previousId, tenantId: member.tenantId } }) : null;
    if (previous?.status === "failed" && Date.now() - previous.updatedAt.getTime() < 90_000) {
      log("модель вернула ошибку, жду перед повтором");
      await new Promise((resolve) => setTimeout(resolve, 30000));
      continue;
    }
    const runningJob = previousId
      ? await prisma.job.findFirst({ where: { type: "agent.turn", status: { in: ["queued", "running"] }, payload: { path: ["threadId"], equals: previousId } } })
      : null;
    if (runningJob || (previous?.status === "running" && Date.now() - (previous.updatedAt?.getTime() || 0) < 8 * 60 * 1000)) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      continue;
    }
    const byCity = await prisma.organization.groupBy({
      by: ["city"],
      where: { tenantId: member.tenantId, isDemo: false, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const cityCount = new Map(byCity.map((row) => [row.city || "", row._count._all]));
    const known = await prisma.parserTask.findMany({
      where: { tenantId: member.tenantId, createdAt: { gte: since } },
      select: { input: true, status: true },
    });
    const seen = new Set(known.map((task) => {
      const input = task.input as { city?: string; category?: string; searchQuery?: string };
      return `${input.city}|${input.category}|${input.searchQuery || ""}`;
    }));
    const batch = pairs.filter((item) => (cityCount.get(item.city) || 0) < 50 && !seen.has(`${item.city}|${item.category}|${item.searchQuery}`)).slice(0, 2);
    let text = "";
    if (state.waiting.length) {
      text = `Сайты ждут ответ Studio. По каждому вызови continue_site и подтверди сборку, если план не добавляет цены, отзывы и лицензии. Для кафе и фастфуда попроси витрину, меню, заказ и доставку без вымышленных сумм. Не выдумывай факты организации.\n${state.waiting.map((item) => item.id).join("\n")}`;
    } else if (state.preview.length && state.published < GOAL) {
      text = `Проверь эти демо и опубликуй те, у которых нет критичных замечаний. Если на сайте кафе, фастфуда или магазина стоят цены блюд, часы или сумма доставки, которых не было в карточке, не публикуй: через continue_site попроси убрать суммы и написать, что стоимость уточняется при заказе. Если инструмент отказал, оставь ссылку на просмотр и не называй сайт опубликованным.\n${state.preview.map((item) => `${item.id} ${item.status} ${item.name}`).join("\n")}`;
    } else if (state.offerQueue.length && state.offers < GOAL) {
      text = `Подготовь коммерческое предложение для этих организаций. Нужен черновик со ссылкой на их демо-сайт. Рассылку не делай.\n${state.offerQueue.map((item) => item.organizationId).join("\n")}`;
    } else if (state.candidates.length && state.sites < GOAL && state.building < 3) {
      text = siteTask(state.candidates);
    } else if (batch.length && state.sites < GOAL && state.pending.length < 2) {
      text = searchTask(batch);
    } else if (state.pending.length || state.building || state.waiting.length || state.preview.length) {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      continue;
    } else {
      log(`остановка: публичных сайтов ${state.published}, КП ${state.offers}, подходящих организаций без сайта больше нет`);
      break;
    }
    try {
      const id = await threadId(member.tenantId, member.userId, true);
      await postAgentMessage(member.tenantId, member.userId, id, text);
      log(`задача агенту: ${text.split("\n")[0]}`);
    } catch (error) {
      log(`задача не поставлена: ${error instanceof Error ? error.message : "ошибка"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  log(`сбой контроля: ${error instanceof Error ? error.message : "ошибка"}`);
  await prisma.$disconnect();
  process.exit(1);
});
