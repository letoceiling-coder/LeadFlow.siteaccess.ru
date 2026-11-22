import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, RetryableError } from "../errors";
import { CONTACT_KINDS, hasContactKind, nextSearchSize, samePlace, searchSampleSize, siteTypeForCategory, userAskedForOffer, userAskedToPublish, userAskedToSend } from "../domain/agent-filters";
import { resolveAgentModel, completeTools, type ChatMessage } from "../integrations/openrouter";
import { requireReady } from "../integrations/config";
import { enqueueJob } from "../jobs/queue";
import { prepareOffer, sendOffer } from "./offers";
import { createSearch, refreshParserTask } from "./parser";
import { approveSite, createSite, freshPreview, publicShare, publishSite, replyToAgent, runQa } from "./sites";
import { getSettings, recordCost } from "./common";

const TOOLS = [
  {
    name: "search_memory",
    description: "Ищет прошлые реплики администратора и ответы агента по всем диалогам этого пространства. Нужно, когда вопрос про уже сказанное, а не про текущую базу организаций.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Слова из прошлого диалога. Пустая строка — последние реплики." } }, required: ["query"] },
  },
  {
    name: "parsing_coverage",
    description: "Города, направления и статусы уже запущенных поисков, плюс сколько организаций лежит в базе. Это источник правды по вопросу «где уже парсили».",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_organizations",
    description: "Отбирает уже сохранённые организации. noWebsite=true оставляет карточки без собственного сайта: сайт не указан, в поле сайта только соцсеть или мессенджер (VK, Telegram, MAX) либо только агрегатор. contactAny — хотя бы один из видов контакта: email, phone, telegram, vk, max, whatsapp, instagram, social.",
    parameters: {
      type: "object",
      properties: {
        cities: { type: "array", items: { type: "string" } },
        category: { type: "string" },
        noWebsite: { type: "boolean" },
        contactAny: { type: "array", items: { type: "string", enum: [...CONTACT_KINDS] } },
        limit: { type: "integer" },
      },
      required: [],
    },
  },
  {
    name: "start_search",
    description: "Запускает реальный поиск Яндекс организаций через Parser API. Один город за вызов. category обязательна. need — сколько организаций должно пройти фильтр. Если заданы noWebsite или contactAny, сырая выборка берётся шире need: парсер отдаёт и организации со своим сайтом. maxResults можно не передавать.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
        category: { type: "string" },
        searchQuery: { type: "string" },
        need: { type: "integer", description: "Сколько подходящих организаций нужно администратору." },
        noWebsite: { type: "boolean" },
        contactAny: { type: "array", items: { type: "string", enum: [...CONTACT_KINDS] } },
        maxResults: { type: "integer", description: "Размер сырой выборки. Для фильтра инструмент увеличит его сам. Для повторного расширения передай nextMaxResults из wait_search." },
        force: { type: "boolean", description: "true только если нужно заново запустить выборку того же размера." },
      },
      required: ["city", "category"],
    },
  },
  {
    name: "wait_search",
    description: "Обновляет задачу поиска и, когда она завершена, сохраняет организации. Вызывай повторно, пока статус не станет completed или failed. Не говори администратору, что поиск закончен, раньше этого.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        need: { type: "integer" },
        noWebsite: { type: "boolean" },
        contactAny: { type: "array", items: { type: "string" } },
        limit: { type: "integer" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "start_sites",
    description: "Ставит генерацию демо-сайтов в Studio. Вызывай только если администратор просил создать сайты. prompt — развёрнутое творческое задание: характер направления, город, какой премиальный сайт уместен именно здесь, какие страницы и акценты. Факты карточки не подменяй. Не выдумывай цены, отзывы и лицензии. Не больше 5 организаций за вызов.",
    parameters: {
      type: "object",
      properties: {
        organizationIds: { type: "array", items: { type: "string" } },
        prompt: { type: "string" },
      },
      required: ["organizationIds", "prompt"],
    },
  },
  {
    name: "site_status",
    description: "Статус генерации и публичная ссылка на сайт. Эту ссылку можно отправлять: страница открывается без входа в Studio.",
    parameters: { type: "object", properties: { siteIds: { type: "array", items: { type: "string" } } }, required: ["siteIds"] },
  },
  {
    name: "continue_site",
    description: "Отвечает Studio, если генерация остановилась в waiting_user: вопрос, план или подтверждение. Если план не добавляет цены, отзывы и лицензии, подтверди сборку. Не выдумывай новые факты.",
    parameters: { type: "object", properties: { siteId: { type: "string" }, text: { type: "string" } }, required: ["siteId", "text"] },
  },
  {
    name: "publish_sites",
    description: "Публикует демо. Вызывай только если администратор в этом задании прямо просил опубликовать. Если проверка качества не пройдена, инструмент сам откажется и оставит ссылку на просмотр.",
    parameters: { type: "object", properties: { siteIds: { type: "array", items: { type: "string" } } }, required: ["siteIds"] },
  },
  {
    name: "prepare_offers",
    description: "Готовит коммерческое предложение: публичная ссылка на сайт организации и контакты для обратной связи из настроек. Не выдумывает цены, сроки и почту получателя. Не отправляет.",
    parameters: { type: "object", properties: { organizationIds: { type: "array", items: { type: "string" } } }, required: ["organizationIds"] },
  },
  {
    name: "send_offers",
    description: "Отправляет подготовленное предложение через подключённые каналы. Сейчас обычно это почта. to=default отправляет тестовую копию на почту рабочего пространства и не пишет организации. to=organization отправляет только на контакт, который уже есть в карточке. Вызывай только если администратор просил отправить.",
    parameters: {
      type: "object",
      properties: {
        organizationIds: { type: "array", items: { type: "string" } },
        to: { type: "string", enum: ["default", "organization"] },
      },
      required: ["organizationIds", "to"],
    },
  },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(value: string | null | undefined, size = 240) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > size ? `${text.slice(0, size)}…` : text;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

async function touch(threadId: string) {
  await prisma.agentThread.update({ where: { id: threadId }, data: { error: null } });
}

async function queryOrganizations(tenantId: string, input: { cities?: string[]; category?: string; noWebsite?: boolean; contactAny?: string[]; limit?: number }) {
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const rows = await prisma.organization.findMany({
    where: {
      tenantId,
      isDemo: false,
      ...(input.noWebsite ? { websiteStatus: { in: ["NO_WEBSITE", "SOCIAL_ONLY", "AGGREGATOR_ONLY"] } } : {}),
      ...(input.category ? { category: { contains: input.category, mode: "insensitive" } } : {}),
    },
    include: { contacts: { select: { type: true, value: true } } },
    orderBy: { createdAt: "desc" },
    take: 800,
  });
  const cities = input.cities ?? [];
  const kinds = (input.contactAny ?? []).filter((item) => (CONTACT_KINDS as readonly string[]).includes(item));
  const matched = rows.filter((row) => {
    if (cities.length && !cities.some((city) => samePlace(row.city, city))) return false;
    if (kinds.length && !hasContactKind(row.contacts, kinds)) return false;
    return true;
  });
  return {
    total: matched.length,
    organizations: matched.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      category: row.category,
      address: row.address,
      websiteStatus: row.websiteStatus,
      website: row.website,
      rating: row.rating,
      services: row.services.slice(0, 8),
      description: clip(row.description),
      contacts: row.contacts.map((item) => ({ type: item.type, value: item.value })),
    })),
  };
}

async function toolResult(tenantId: string, userId: string, threadId: string, name: string, raw: Record<string, unknown>) {
  if (name === "search_memory") {
    const query = String(raw.query || "").trim();
    const rows = await prisma.agentMessage.findMany({
      where: {
        tenantId,
        role: { in: ["user", "assistant"] },
        ...(query ? { content: { contains: query, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { thread: { select: { title: true } } },
    });
    return { found: rows.length, items: rows.map((row) => ({ at: row.createdAt, thread: row.thread.title, role: row.role, text: clip(row.content, 500) })) };
  }
  if (name === "parsing_coverage") {
    const tasks = await prisma.parserTask.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, status: true, organizationCount: true, createdAt: true, input: true, error: true },
    });
    const coverage = tasks.map((task) => {
      const input = (task.input ?? {}) as { city?: string; category?: string; searchQuery?: string; maxResults?: number };
      return { taskId: task.id, status: task.status, city: input.city ?? null, category: input.category ?? null, searchQuery: input.searchQuery || null, maxResults: input.maxResults ?? null, saved: task.organizationCount, at: task.createdAt, error: task.error };
    });
    const orgs = await prisma.organization.groupBy({ by: ["city", "category"], where: { tenantId, isDemo: false }, _count: { _all: true } });
    const database = orgs
      .map((row) => ({ city: row.city, category: row.category, count: row._count._all }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 40);
    return { searches: coverage, database };
  }
  if (name === "find_organizations") return queryOrganizations(tenantId, raw as { cities?: string[]; category?: string; noWebsite?: boolean; contactAny?: string[]; limit?: number });
  if (name === "start_search") {
    const city = String(raw.city || "").trim();
    const category = String(raw.category || "").trim();
    const contactAny = asStringArray(raw.contactAny).filter((item) => (CONTACT_KINDS as readonly string[]).includes(item));
    const noWebsite = Boolean(raw.noWebsite);
    const filtered = noWebsite || contactAny.length > 0;
    const requested = Number(raw.maxResults) || Number(raw.need) || 5;
    const need = Math.min(Math.max(Number(raw.need) || (filtered ? requested : 0), 0), 50);
    const maxResults = searchSampleSize(need, requested, filtered);
    if (!city || !category) return { error: "Нужны город и направление. Без направления поиск не запускаю, чтобы не тратить квоту впустую." };
    const created = await createSearch(tenantId, userId, {
      city,
      region: "",
      category,
      searchQuery: String(raw.searchQuery || ""),
      maxResults,
      includePhotos: false,
      outputFormat: "json",
      force: Boolean(raw.force),
      confirmLarge: false,
      need,
      noWebsite,
      contactAny,
    });
    return {
      taskId: created.task.id,
      status: created.task.status,
      duplicate: created.duplicate,
      city,
      category,
      need,
      maxResults,
      widened: maxResults > requested,
      note: maxResults > requested ? `Сырая выборка ${maxResults}: часть карточек не пройдёт фильтр, в ответ пойдут только подходящие.` : null,
    };
  }
  if (name === "wait_search") {
    const taskId = String(raw.taskId || "");
    const started = Date.now();
    let task = await refreshParserTask(tenantId, taskId);
    while (!["completed", "failed", "cancelled"].includes(task.status) && Date.now() - started < 20000) {
      await sleep(4000);
      task = await refreshParserTask(tenantId, taskId);
    }
    const input = (task.input ?? {}) as { city?: string; category?: string; maxResults?: number; need?: number; noWebsite?: boolean; contactAny?: string[] };
    const contactAny = asStringArray(raw.contactAny).length ? asStringArray(raw.contactAny) : asStringArray(input.contactAny);
    const noWebsite = raw.noWebsite == null ? Boolean(input.noWebsite) : Boolean(raw.noWebsite);
    const need = Math.min(Math.max(Number(raw.need) || Number(input.need) || 0, 0), 50);
    const matches = task.status === "completed"
      ? await queryOrganizations(tenantId, { cities: input.city ? [input.city] : [], category: input.category, noWebsite, contactAny, limit: need || Number(raw.limit) || 10 })
      : null;
    const have = matches?.total ?? 0;
    const maxResults = Number(input.maxResults) || 0;
    const next = matches ? nextSearchSize(maxResults, have, need, task.organizationCount ?? 0) : null;
    return {
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      saved: task.organizationCount,
      error: task.error,
      city: input.city ?? null,
      category: input.category ?? null,
      need: need || null,
      have,
      enough: !need || have >= need,
      exhausted: Boolean(need) && have < need && next == null && ["completed", "failed", "cancelled"].includes(task.status),
      nextMaxResults: next,
      matches,
    };
  }
  if (name === "start_sites") {
    const ids = asStringArray(raw.organizationIds).slice(0, 5);
    const prompt = String(raw.prompt || "").trim();
    if (!ids.length) return { error: "Не переданы организации." };
    if (prompt.length < 120) return { error: "Промпт слишком короткий для премиального сайта. Опиши характер направления, город, состав страниц и подачу. Цены, отзывы и лицензии не выдумывай." };
    const started = [];
    for (const organizationId of ids) {
      try {
        const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId, isDemo: false } });
        if (!organization) {
          started.push({ organizationId, error: "Организация не найдена в этой базе." });
          continue;
        }
        const siteType = siteTypeForCategory(organization.category);
        const pages = siteType === "restaurant"
          ? ["Главная", "Меню", "Заказ", "Доставка", "Контакты"]
          : ["Главная", "Направления", "Как проходит работа", "Контакты"];
        const created = await createSite(tenantId, userId, {
          organizationId,
          siteType,
          language: "ru",
          pages,
          wishes: `${prompt}\n\nОрганизация: ${organization.name}. Город: ${organization.city ?? "не указан"}. Направление: ${organization.category ?? "не указано"}. Сделай широкий премиальный сайт этого направления. Контакты и название бери только из карточки.${siteType === "restaurant" ? " Для еды и продуктов нужны витрина, меню или каталог, оформление заказа и расчёт доставки. Суммы, сроки и условия доставки не выдумывай." : ""}`,
          confirm: true,
        });
        started.push({ organizationId, name: organization.name, siteId: created.project.id, status: created.project.status, existing: created.existing });
      } catch (error) {
        started.push({ organizationId, error: error instanceof Error ? error.message : "Не удалось поставить генерацию." });
      }
    }
    return { started, note: ids.length < asStringArray(raw.organizationIds).length ? "За один вызов ставлю не больше 5 сайтов." : null };
  }
  if (name === "continue_site") {
    const siteId = String(raw.siteId || "");
    const text = String(raw.text || "").trim();
    if (!siteId || text.length < 2) return { error: "Нужны сайт и текст ответа Studio." };
    const sent = await replyToAgent(tenantId, userId, siteId, text);
    return { siteId, taskId: sent.taskId, status: "building" };
  }
  if (name === "site_status") {
    const sites = [];
    for (const siteId of asStringArray(raw.siteIds).slice(0, 8)) {
      let project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId }, include: { organization: { select: { name: true, city: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1 } } });
      const waitStarted = Date.now();
      while (project && ["queued", "building"].includes(project.status) && Date.now() - waitStarted < 20000) {
        await sleep(4000);
        project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId }, include: { organization: { select: { name: true, city: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1 } } });
      }
      if (!project) {
        sites.push({ siteId, error: "Проект не найден." });
        continue;
      }
      let previewUrl: string | null = null;
      let previewError: string | null = null;
      if (project.studioProjectId && ["preview_ready", "qa_running", "qa_passed", "qa_failed", "approved", "publish_requested", "published"].includes(project.status)) {
        try {
          previewUrl = (await publicShare(tenantId, userId, project.id)).url;
        } catch (error) {
          previewError = error instanceof Error ? error.message : "Публичная ссылка не получена.";
        }
      }
      sites.push({
        siteId: project.id,
        name: project.organization.name,
        city: project.organization.city,
        status: project.status,
        studioQuestion: clip(project.runs[0]?.replyText, 900) || null,
        previewUrl,
        previewError,
        error: project.error,
      });
    }
    return { sites };
  }
  if (name === "publish_sites") {
    const lastUser = await prisma.agentMessage.findFirst({ where: { threadId, role: "user" }, orderBy: { createdAt: "desc" } });
    if (!lastUser || !userAskedToPublish(lastUser.content)) {
      return { error: "Публикация не запускалась: в текущем задании нет прямой просьбы опубликовать." };
    }
    const sites = [];
    for (const siteId of asStringArray(raw.siteIds).slice(0, 5)) {
      try {
        const project = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
        if (!project) {
          sites.push({ siteId, error: "Проект не найден." });
          continue;
        }
        if (!["preview_ready", "qa_passed", "qa_failed", "approved", "publish_requested", "published"].includes(project.status)) {
          sites.push({ siteId, status: project.status, error: "Сайт ещё собирается, публиковать рано." });
          continue;
        }
        await runQa(tenantId, userId, siteId);
        const checked = await prisma.siteProject.findFirst({ where: { id: siteId, tenantId } });
        const preview = await freshPreview(tenantId, siteId).catch(() => null);
        if (!checked || checked.criticalCount > 0 || checked.status === "qa_failed") {
          sites.push({ siteId, status: checked?.status, previewUrl: preview?.url ?? null, error: "Публикация остановлена: проверка нашла критические замечания." });
          continue;
        }
        if (checked.status !== "approved" && checked.status !== "publish_requested") await approveSite(tenantId, userId, siteId, "Подтверждено администратором в диалоге агента.");
        const published = await publishSite(tenantId, userId, siteId, "public");
        const shared = await publicShare(tenantId, userId, siteId).catch(() => null);
        sites.push({ siteId, status: published.status, previewUrl: shared?.url ?? null });
      } catch (error) {
        const preview = await freshPreview(tenantId, siteId).catch(() => null);
        sites.push({ siteId, previewUrl: preview?.url ?? null, error: error instanceof Error ? error.message : "Публикация не выполнена." });
      }
    }
    return { sites };
  }
  if (name === "prepare_offers" || name === "send_offers") {
    const lastUser = await prisma.agentMessage.findFirst({ where: { threadId, role: "user" }, orderBy: { createdAt: "desc" } });
    const asked = lastUser ? userAskedForOffer(lastUser.content) || userAskedToSend(lastUser.content) : false;
    if (!asked) return { error: "Предложение не готовилось: в текущем задании нет просьбы подготовить или отправить КП." };
    if (name === "send_offers" && (!lastUser || !userAskedToSend(lastUser.content))) {
      return { error: "Отправка не запускалась: администратор просил подготовить предложение, но не отправлять его." };
    }
    const target = raw.to === "organization" ? "organization" : "default";
    const offers = [];
    for (const organizationId of asStringArray(raw.organizationIds).slice(0, 5)) {
      try {
        offers.push(name === "prepare_offers" ? await prepareOffer(tenantId, userId, organizationId) : await sendOffer(tenantId, userId, organizationId, target));
      } catch (error) {
        offers.push({ organizationId, error: error instanceof Error ? error.message : "Предложение не собрано." });
      }
    }
    return { offers };
  }
  return { error: `Неизвестный инструмент ${name}` };
}

const SYSTEM = `Ты операционный агент LeadFlow. С тобой говорит администратор рабочего пространства. Ты сам решаешь, какие инструменты вызвать, и отвечаешь по-русски по существу.

Правила:
- Не выдумывай организации, контакты, города, направления поиска и ссылки. Если инструмента нет или он вернул ошибку, так и скажи.
- Вопрос «где уже парсили» закрывай инструментом parsing_coverage. Прошлые договорённости ищи через search_memory. Если память и база расходятся, верь базе.
- Поиск запускай только когда понятны город и направление. Если направления нет, спроси, а не запускай общий поиск.
- Один start_search — один город. Для нескольких городов вызови инструмент несколько раз.
- need — это сколько организаций должно пройти условие, а не сколько строк забрать у парсера. Если администратор просит N без своего сайта или с почтой и соцсетями, передай need=N, noWebsite и contactAny. «Почта или соцсети» — это email, telegram, vk, max, whatsapp, instagram, social. Телефон сам по себе такое условие не закрывает.
- После start_search вызывай wait_search с теми же need, noWebsite и contactAny, пока статус не станет completed или failed. Пока идёт поиск, не выдавай выдуманный список.
- Если в последнем задании прямо написано «wait_search не вызывай», вызови только start_search и сразу закончи ход. Карточки сохранит фоновый опрос, список в этом ходе не составляй.
- Условие «нет сайта» — это noWebsite=true. Туда входят карточки, где вместо сайта указаны VK, Telegram, MAX или страница агрегатора. В ответе администратору называй только организации из matches. Карточки со своим сайтом, которые попали в сырую выборку, результатом задания не являются.
- Если wait_search вернул nextMaxResults, сразу вызови start_search с этим maxResults, тем же городом, направлением, need и фильтрами. Не отвечай администратору, пока enough не станет true или не появится exhausted. Если выборка исчерпана и подходящих меньше N, скажи точное число и не добирай список выдумкой.
- Сайты создавай только по прямой просьбе. В prompt напиши развёрнутое задание на премиальный сайт: характер направления, город, страницы, настроение и акценты. Контакты, адрес и название не выдумывай. Цены, отзывы, лицензии и награды не придумывай. Короткий промпт из пары фраз не отправляй.
- Если Studio предлагает бедный план из одной страницы или пустой визитки, не подтверждай его. Через continue_site попроси широкий премиальный сайт по брифу. Другой вопрос Studio тоже закрывай через continue_site, затем снова site_status.
- Ссылку для отправки бери из site_status. Это публичный адрес: его можно переслать, он открывается без входа в Studio. Короткое превью preview.siteaccess.ru без токена не открывается.
- publish_sites вызывай только если администратор просил опубликовать. Если инструмент отказал, объясни причину и дай ссылку на просмотр, не называй сайт опубликованным.
- Коммерческое предложение готовь через prepare_offers, когда администратор просит КП или предложение. Письмо уже собрано шаблоном: персональный текст по категории, ссылка и скриншот демонстрационного сайта, мини-приложение, контакты для ответа и ссылка «Отписаться от рассылки». Не переписывай письмо своими словами, не выкидывай эти части и не выдумывай цены, сроки, почту и телефон получателя. Пока администратор не согласовал шаблон, не отправляй массовую рассылку.
- Отправляй предложение через send_offers только по прямой просьбе отправить. Канал берётся из подключённых интеграций: сейчас это почта. to=default — тестовая копия на почту рабочего пространства, организации письмо не уходит. to=organization — только если в карточке уже есть почта или другой контакт этого канала. Нет контакта — так и скажи, адрес не подставляй.
- Если инструмент ответил, что клиент нажал «Не беспокоить» или с ним нельзя связываться, остановись. Не готовь новое письмо, не меняй канал и не отправляй повторно.
- Свой текст предложения администратору показывай по ответу инструмента, не заменяй ссылки.
- Генерация идёт по одной. Если часть сайтов ещё собирается, перечисли готовые ссылки и статус остальных.`;

export async function postAgentMessage(tenantId: string, userId: string, threadId: string, text: string) {
  const clean = text.trim();
  if (!clean || clean.length > 4000) throw new ApiError(422, "Напишите задание, до 4000 символов.", "bad_message");
  const thread = await prisma.agentThread.findFirst({ where: { id: threadId, tenantId } });
  if (!thread) throw new ApiError(404, "Диалог не найден", "not_found");
  if (thread.status === "running" && Date.now() - thread.updatedAt.getTime() < 8 * 60 * 1000) {
    throw new ApiError(409, "Агент ещё выполняет предыдущее задание. Дождитесь ответа.", "agent_busy");
  }
  const message = await prisma.agentMessage.create({ data: { tenantId, threadId, role: "user", content: clean } });
  await prisma.agentThread.update({
    where: { id: threadId },
    data: { status: "running", error: null, title: thread.title === "Новый диалог" ? clean.slice(0, 80) : thread.title },
  });
  await enqueueJob({ tenantId, type: "agent.turn", payload: { threadId }, idempotencyKey: `agent:${message.id}`, maxAttempts: 2 });
  return { ok: true };
}

export async function runAgentTurn(threadId: string) {
  const thread = await prisma.agentThread.findUnique({ where: { id: threadId } });
  if (!thread) return;
  let toolsUsed = false;
  try {
    const integration = await requireReady(thread.tenantId, "openrouter", "Агент");
    const settings = await getSettings(thread.tenantId);
    const model = resolveAgentModel(settings.ai.agentModel);
    const history = await prisma.agentMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, take: 40 });
    const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }];
    const recent = history.slice(-16);
    while (recent[0]?.role === "tool") recent.shift();
    for (const item of recent) {
      if (item.role === "tool") {
        const callId = (item.toolJson as { tool_call_id?: string } | null)?.tool_call_id;
        if (callId) messages.push({ role: "tool", tool_call_id: callId, content: item.content.slice(0, 2500) });
      } else if (item.role === "assistant") {
        const calls = (item.toolJson as { tool_calls?: unknown } | null)?.tool_calls;
        messages.push({ role: "assistant", content: item.content || null, ...(calls ? { tool_calls: calls } : {}) });
      } else messages.push({ role: item.role, content: item.content });
    }
    for (let round = 0; round < 16; round += 1) {
      await touch(threadId);
      const result = await completeTools({
        baseUrl: String(integration.config.baseUrl),
        apiKey: integration.secrets.apiKey, secrets: integration.secrets,
        model,
        messages,
        tools: TOOLS,
      });
      if (typeof result.usage.cost === "number") {
        await recordCost({ tenantId: thread.tenantId, provider: "openrouter", operation: "agent.turn", amountUsd: result.usage.cost, refType: "agent_thread", refId: threadId });
      }
      const calls = result.message.tool_calls ?? [];
      await prisma.agentMessage.create({
        data: {
          tenantId: thread.tenantId,
          threadId,
          role: "assistant",
          content: result.message.content || "",
          toolJson: calls.length ? ({ tool_calls: calls } as Prisma.InputJsonValue) : undefined,
        },
      });
      messages.push({ role: "assistant", content: result.message.content || null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (!calls.length) {
        await prisma.agentThread.update({ where: { id: threadId }, data: { status: "idle", error: null } });
        return;
      }
      for (const call of calls) {
        toolsUsed = true;
        const toolName = call.function?.name || "unknown";
        let args: Record<string, unknown> = {};
        try {
          const argumentText = typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments || {});
          args = JSON.parse(argumentText || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        let payload: unknown;
        try {
          payload = await toolResult(thread.tenantId, thread.userId, threadId, toolName, args);
        } catch (error) {
          payload = { error: error instanceof Error ? error.message : "Инструмент не выполнен." };
        }
        const content = JSON.stringify(payload).slice(0, 12000);
        await prisma.agentMessage.create({
          data: { tenantId: thread.tenantId, threadId, role: "tool", toolName, content, toolJson: { tool_call_id: call.id || toolName } },
        });
        messages.push({ role: "tool", tool_call_id: call.id || toolName, content });
      }
    }
    await prisma.agentMessage.create({
      data: { tenantId: thread.tenantId, threadId, role: "assistant", content: "Остановился после нескольких шагов, чтобы не зациклиться. Напишите, что сделать следующим." },
    });
    await prisma.agentThread.update({ where: { id: threadId }, data: { status: "idle", error: null } });
  } catch (error) {
    if (error instanceof RetryableError && !toolsUsed) throw error;
    const message = error instanceof Error ? error.message : "Агент остановился";
    await prisma.agentMessage.create({ data: { tenantId: thread.tenantId, threadId, role: "assistant", content: message.slice(0, 700) } });
    await prisma.agentThread.update({ where: { id: threadId }, data: { status: "failed", error: message.slice(0, 500) } });
  }
}
