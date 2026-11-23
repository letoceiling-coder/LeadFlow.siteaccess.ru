import { z } from "zod";
import { detectSegment, isSegment, segmentInfo, type SegmentId } from "./segments";
import { siteChaos as scanChaos, siteIsGood, type SiteScan } from "./site-scan";

/** Квалификация по стратегии NEEKLO v2: скоринг §4 и карточка наблюдения §5. */

export const QUALIFY_PROMPT_VERSION = "qualify-v2";
export const QUALIFY_THRESHOLD = 60;

const factSchema = z.object({ text: z.string().trim().min(3).max(300), source: z.string().trim().max(60) });
const factList = z.object({ facts: z.array(factSchema).max(6).default([]) }).default({ facts: [] });

export const qualifyResultSchema = z.object({
  segment: z.string().nullable().optional(),
  observation: z.string().trim().max(400).nullable().optional(),
  money: factList,
  chaos: factList,
  growth: factList,
  repeatable: z.boolean().nullable().optional(),
  microBusiness: z.boolean().optional().default(false),
  irrelevant: z.boolean().optional().default(false),
  goodSiteAlready: z.boolean().optional().default(false),
  avgCheckRub: z.number().positive().max(10_000_000).nullable().optional(),
  lostPerMonth: z.number().positive().max(10_000).nullable().optional(),
  features: z.array(z.string().trim().min(2).max(120)).max(5).optional().default([]),
});

export type QualifyResult = z.infer<typeof qualifyResultSchema>;

export type QualifyFacts = {
  name: string;
  category: string | null;
  categories: string[];
  city: string | null;
  address: string | null;
  website: string | null;
  websiteStatus: string;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  services: string[];
  features: string[];
  description: string | null;
  sourceUrl: string | null;
  phones: string[];
  emails: string[];
  socials: string[];
  /** Скан сайта через парсер: что реально есть на странице. */
  site?: SiteScan | null;
  /** Тексты свежих отзывов с карт — в них клиенты сами пишут, где теряются заявки. */
  reviews?: string[];
};

export type CardFact = { text: string; source: string; kind: "fact" | "assumption" };

/** Федеральные сети не клиенты студии: у них свой IT-отдел. Признак — номер 8-800 или известное имя сети. */
const CHAINS = ["додо", "dodo", "ёбидоёби", "ебидоеби", "kfc", "rostic", "ростикс", "вкусно и точка", "бургер кинг", "burger king", "папа джонс", "papa john", "тануки", "якитория", "шоколадница", "кофе хауз", "теремок", "суши wok", "суши вок", "сушивесла", "domino", "доминос", "subway", "сабвей", "starbucks", "cofix", "кофикс", "стардогс", "крошка картошка", "fit service", "фит сервис", "точка ремонта", "автомир", "вианор", "колесо.ру"];

export function isFederalChain(name: string, phones: string[]) {
  const lower = name.toLowerCase().replace(/ё/g, "е");
  if (CHAINS.some((chain) => lower.includes(chain.replace(/ё/g, "е")))) return true;
  return phones.some((phone) => /^\+?[78]800/.test(phone.replace(/[^\d+]/g, "")));
}

export type ObservationCard = {
  segment: SegmentId | null;
  observation: string | null;
  money: CardFact[];
  chaos: CardFact[];
  growth: CardFact[];
  calc: { text: string; avgCheckRub: number; lostPerMonth: number; lostRub: number } | null;
  caseRef: string | null;
  contact: { kind: string; value: string }[];
  features: string[];
  chain?: boolean;
  /** По скану: сайт уже хороший (адаптив, запись или корзина) — продавать сайт поздно. */
  goodSite?: boolean;
};

export type StrategyFactor = { key: string; label: string; points: number; hit: boolean; reason: string };

/** Поля, на которые AI может ссылаться как на источник факта. Пустые поля ссылкой быть не могут. */
export function allowedSources(facts: QualifyFacts): Set<string> {
  const allowed = new Set<string>();
  const entries: [string, unknown][] = Object.entries(facts);
  for (const [key, value] of entries) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && !value.trim()) continue;
    allowed.add(key);
  }
  return allowed;
}

/** Из каких полей можно брать факт каждого вида. name, city, category фактом денег или хаоса быть не могут. */
const SOURCES = {
  money: new Set(["reviewCount", "rating", "services", "description", "features", "photoCount", "reviews"]),
  chaos: new Set(["websiteStatus", "website", "socials", "phones", "emails", "description", "features", "site", "reviews"]),
  growth: new Set(["description", "features", "services", "reviewCount"]),
} as const;

function hasOwnSite(facts: QualifyFacts) {
  return facts.websiteStatus === "WEBSITE_EXISTS" || (facts.websiteStatus === "UNCERTAIN" && Boolean(facts.website));
}

function sourceText(facts: QualifyFacts, source: string): string {
  const value = (facts as Record<string, unknown>)[source];
  if (value == null) return "";
  return (Array.isArray(value) ? value.join(" ") : String(value)).toLowerCase();
}

/** Числа из текста факта должны встречаться в поле-источнике: «312 отзывов» при 146 отзывах отбрасывается. */
function numbersSupported(text: string, source: string) {
  const numbers = text.replace(/(\d)\s(?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) ?? [];
  const haystack = source.replace(/\s/g, "");
  return numbers.every((num) => haystack.includes(num.replace(",", ".")) || haystack.includes(num));
}

/** Бесплатные конструкторы и визитки: сайт формально есть, но заявки и каталог на нём не живут. */
const BUILDER_HOSTS = ["clients.site", "taplink.cc", "taplink.ws", "tilda.ws", "wixsite.com", "ucoz.ru", "ucoz.net", "nethouse.ru", "flexbe.online", "mssg.me", "hipolink.me", "vsite.biz", "business.site"];

export function builderHost(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.toLowerCase();
    return BUILDER_HOSTS.find((item) => host === item || host.endsWith(`.${item}`)) ?? null;
  } catch {
    return null;
  }
}

/** Парсер не дочитал карточку: нет названия или нет ни контакта, ни сайта. Такую не отправляем в AI. */
export function isIncomplete(facts: QualifyFacts) {
  const name = facts.name.trim().toLowerCase();
  const noName = !name || name === "unknown" || name === "без названия";
  const noContact = !facts.phones.length && !facts.emails.length && !facts.socials.length && !facts.website;
  return noName || noContact;
}

const NO_SITE = /нет (своего |собственного )?сайта|без сайта|сайта нет|не имеет сайта/i;

function cleanFacts(kind: keyof typeof SOURCES, list: { text: string; source: string }[], facts: QualifyFacts, allowed: Set<string>): CardFact[] {
  const seen = new Set<string>();
  const out: CardFact[] = [];
  for (const item of list) {
    if (!allowed.has(item.source) || !SOURCES[kind].has(item.source)) continue;
    if (!numbersSupported(item.text, sourceText(facts, item.source))) continue;
    if (NO_SITE.test(item.text) && hasOwnSite(facts)) continue;
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: item.text, source: item.source, kind: "fact" });
  }
  return out;
}

function contactsOf(facts: QualifyFacts) {
  return [
    ...facts.phones.map((value) => ({ kind: "phone", value })),
    ...facts.emails.map((value) => ({ kind: "email", value })),
    ...facts.socials.map((value) => ({ kind: "social", value })),
  ];
}

/** Собирает карточку §5: факты AI проходят проверку источника, детерминированные факты добавляются из данных. */
export function buildCard(facts: QualifyFacts, ai: QualifyResult | null): ObservationCard {
  const allowed = allowedSources(facts);
  const money = cleanFacts("money", ai?.money.facts ?? [], facts, allowed);
  const chaos = cleanFacts("chaos", ai?.chaos.facts ?? [], facts, allowed);
  const growth = cleanFacts("growth", ai?.growth.facts ?? [], facts, allowed);

  if ((facts.reviewCount ?? 0) >= 100 && !money.some((item) => item.source === "reviewCount")) {
    money.push({ text: `${facts.reviewCount} ${plural(facts.reviewCount!, "отзыв", "отзыва", "отзывов")} на картах`, source: "reviewCount", kind: "fact" });
  }
  if (facts.websiteStatus === "NO_WEBSITE" && !chaos.some((item) => item.source === "websiteStatus" || item.source === "website")) {
    chaos.push({ text: "Нет своего сайта — только карточка на картах", source: "websiteStatus", kind: "fact" });
  }

  // Хаос без AI — по статусу сайта: соцсеть или агрегатор вместо сайта, сайт не открывается (§1, «признак хаоса»).
  const siteChaos: Record<string, string> = {
    SOCIAL_ONLY: "Вместо сайта — страница в соцсети",
    AGGREGATOR_ONLY: "Своего сайта нет — только агрегатор",
    BROKEN_WEBSITE: "Сайт из карточки не открывается",
  };
  if (siteChaos[facts.websiteStatus] && !chaos.some((item) => item.source === "websiteStatus" || item.source === "website")) {
    chaos.push({ text: siteChaos[facts.websiteStatus], source: "websiteStatus", kind: "fact" });
  }

  const builder = builderHost(facts.website);
  if (builder && !chaos.some((item) => item.source === "website")) {
    chaos.push({ text: `Сайт на бесплатном конструкторе (${builder}) — без каталога и заявок`, source: "website", kind: "fact" });
  }

  const aiSegment = ai?.segment && isSegment(ai.segment) ? ai.segment : null;
  const segment = aiSegment ?? detectSegment(facts.category, facts.categories);

  // Хаос из отзывов: клиенты сами пишут, что не дозвониться или не перезвонили — это потерянные заявки.
  const complaint = reviewComplaint(facts.reviews ?? []);
  if (complaint && !chaos.some((item) => item.source === "reviews")) chaos.unshift({ text: complaint, source: "reviews", kind: "fact" });
  const priced = facts.services.filter((item) => /\d\s?₽|руб/.test(item)).length;
  if (priced >= 5 && !growth.some((item) => item.source === "services")) growth.push({ text: `Прайс на картах: ${priced} услуг с ценами`, source: "services", kind: "fact" });

  // Хаос со страницы сайта: открыли её через парсер и проверили запись, корзину, цены, адаптив.
  if (facts.site) {
    for (const text of scanChaos(facts.site, segment)) {
      if (chaos.length >= 5) break;
      if (!chaos.some((item) => item.text.toLowerCase() === text.toLowerCase())) chaos.push({ text, source: "site", kind: "fact" });
    }
  }

  let calc: ObservationCard["calc"] = null;
  if (ai?.avgCheckRub && ai?.lostPerMonth) {
    const lostRub = Math.round(ai.avgCheckRub * ai.lostPerMonth);
    calc = {
      avgCheckRub: Math.round(ai.avgCheckRub),
      lostPerMonth: Math.round(ai.lostPerMonth),
      lostRub,
      text: `При среднем чеке ${rub(ai.avgCheckRub)} и потере даже ${Math.round(ai.lostPerMonth)} заявок в месяц — ${rub(lostRub)} упущено (оценка)`,
    };
  }

  const noSite = chaos.some((item) => item.source === "websiteStatus");
  // Крючок от AI берём, только если он не противоречит данным: «нет сайта» при живом сайте отбрасывается.
  const aiHook = ai?.observation?.trim() || null;
  const hookOk = aiHook && !(NO_SITE.test(aiHook) && hasOwnSite(facts)) && numbersSupported(aiHook, JSON.stringify(facts).toLowerCase());
  const observation = (hookOk ? aiHook : null) || (noSite ? "у вас нет своего сайта, клиенты находят вас только на картах" : chaos[0]?.text) || null;
  return {
    segment,
    observation,
    money,
    chaos,
    growth,
    calc,
    caseRef: segmentInfo(segment)?.case ?? null,
    contact: contactsOf(facts),
    features: ai?.features ?? [],
    chain: isFederalChain(facts.name, facts.phones),
    goodSite: siteIsGood(facts.site),
  };
}

const COMPLAINTS: [RegExp, string][] = [
  [/не дозвон|невозможно дозвон|трубку не бер|не берут трубк|не брали трубк|не отвечают на звон|телефон не отвеча/i, "В отзывах пишут, что к вам трудно дозвониться"],
  [/не перезвонил|не перезвонили|обещали перезвонить|так и не позвонил/i, "В отзывах пишут, что обещали перезвонить и не перезвонили"],
  [/долго (?:не )?отвеча|не ответили на сообщ|сообщения игнор|в ватсап[еп]? не отвеч|в whatsapp не отвеч/i, "В отзывах жалуются, что долго отвечают на сообщения"],
  [/запис(?:ь|аться) (?:только )?по телефону|не смог(?:ла)? записаться|сложно записаться|негде записаться/i, "В отзывах пишут, что записаться можно только по телефону"],
  [/долго ждал[аи]? заказ|заказ (?:привезли|доставили) через|опоздал[аи]? с доставк|перепутали заказ/i, "В отзывах жалуются на заказы: путаница или долгая доставка"],
];

/** Первая жалоба из отзывов, которая говорит о потерянных заявках. Текст — наш пересказ, без цитаты. */
export function reviewComplaint(reviews: string[]): string | null {
  for (const [re, text] of COMPLAINTS) if (reviews.some((review) => re.test(review))) return text;
  return null;
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function rub(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

const REPEATABLE_SEGMENTS = new Set<string>(["A1", "A2", "A5", "A6", "B1", "B2", "B3", "B4"]);

/** Скоринг 0–100 по §4. */
export function strategyScore(card: ObservationCard, ai: QualifyResult | null) {
  const hasContact = card.contact.length > 0;
  const factors: StrategyFactor[] = [];
  const push = (key: string, label: string, points: number, hit: boolean, reason: string) =>
    factors.push({ key, label, points: hit ? points : 0, hit, reason });

  push("money", "Признак денег", 30, card.money.length > 0, card.money.map((item) => item.text).join("; ") || "Подтверждённого признака денег нет");
  push("chaos", "Явный хаос", 25, card.chaos.length > 0, card.chaos.map((item) => item.text).join("; ") || "Подтверждённого хаоса нет");
  // Без оценки AI повторяемость берётся из ниши: доставка, автосервис, клиники, базы, дилеры живут на повторных заказах.
  const bySegment = ai?.repeatable == null && card.segment != null && REPEATABLE_SEGMENTS.has(card.segment);
  push("repeatable", "Повторяемый процесс", 15, ai?.repeatable === true || bySegment, ai?.repeatable == null ? (bySegment ? "По нише: заказы, запись или бронь повторяются" : "Не оценивалось") : ai.repeatable ? "Бронь, каталог, заказы — повторяются" : "Разовая услуга");
  push("contact", "Публичный контакт", 15, hasContact, hasContact ? `${card.contact.length} контакт(ов) в источнике` : "Контактов нет");
  push("growth", "Признаки роста", 10, card.growth.length > 0, card.growth.map((item) => item.text).join("; ") || "Не найдено");
  push("case", "Есть кейс NEEKLO", 10, Boolean(card.caseRef), card.caseRef ?? "Кейса под эту нишу нет");
  push("micro", "Микробизнес", -30, ai?.microBusiness === true, "Похоже на микробизнес без оборота");
  push("goodSite", "Уже есть хороший сайт", -40, ai?.goodSiteAlready === true || card.goodSite === true, "Есть сайт с формой, записью или каталогом");
  push("noContact", "Нет контакта", -15, !hasContact, "Нет публичного контакта");
  push("irrelevant", "Нерелевант или спам", -50, ai?.irrelevant === true, "Карточка нерелевантна");
  push("chain", "Федеральная сеть", -70, card.chain === true, "Номер 8-800 или известная сеть — свой IT-отдел, не клиент студии");

  const score = Math.max(0, Math.min(100, factors.reduce((sum, item) => sum + item.points, 0)));
  const ready = card.money.length > 0 && card.chaos.length > 0 && hasContact;
  return { score, factors, ready, priority: priorityOf(score, ready) };
}

export type Priority = "A" | "B" | "C" | "D";

/** Флаги прошлой оценки AI, восстановленные из сохранённых факторов, — чтобы пересчитать балл после ручного факта. */
export function flagsFromFactors(factors: StrategyFactor[] | null | undefined): QualifyResult {
  const hit = (key: string) => Boolean(factors?.find((item) => item.key === key)?.hit);
  const repeat = factors?.find((item) => item.key === "repeatable");
  return qualifyResultSchema.parse({
    repeatable: repeat ? (repeat.hit && !repeat.reason.startsWith("По нише") ? true : repeat.reason === "Разовая услуга" ? false : null) : null,
    microBusiness: hit("micro"),
    goodSiteAlready: hit("goodSite"),
    irrelevant: hit("irrelevant"),
  });
}

/** Факт, который подтвердил человек (§3, шаг 5: «факт реален?»). Стоп-правило не нарушается: факт есть, просто источник — проверка глазами. */
export function addManualFact(card: ObservationCard, kind: "money" | "chaos", text: string): ObservationCard {
  const clean = text.trim().slice(0, 200);
  const list = card[kind];
  if (!clean || list.some((item) => item.text.toLowerCase() === clean.toLowerCase())) return card;
  return { ...card, [kind]: [...list, { text: clean, source: "manual", kind: "fact" }] };
}

/** A — 75+, B — 60–74. Без подтверждённых фактов карточка не поднимается выше C (стоп-правило §5). */
export function priorityOf(score: number, ready: boolean): Priority {
  if (ready && score >= 75) return "A";
  if (ready && score >= QUALIFY_THRESHOLD) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function buildQualifyPrompt(facts: QualifyFacts) {
  const sources = [...allowedSources(facts)].join(", ");
  const system = [
    "Ты квалифицируешь бизнес для студии, которая делает сайты, каталоги, онлайн-запись и кабинеты. Отвечай только JSON без markdown.",
    "Задача: найти ПОДТВЕРЖДЁННЫЕ признаки денег и хаоса в переданных полях. Ничего не выдумывай.",
    "Каждый факт — объект {text, source}. source — имя поля входных данных, откуда факт взят. Допустимые source: " + sources + ".",
    "Факт без такого поля не пиши. Если не нашёл — оставь пустой массив.",
    "money — признаки оборота: много отзывов, филиалы, дорогой чек, платная реклама, много услуг.",
    "chaos — признаки ручной работы: нет сайта, сайт-заглушка или соцсеть вместо сайта, заявки только по телефону или в мессенджер, прайс картинкой.",
    "growth — новые точки, акции, вакансии, свежие отзывы.",
    "segment — один из A1 доставка еды, A2 автосервис, A3 потолки/ремонт/мастера, A4 дорогой ретейл, A5 клиники, A6 глэмпинги/базы, B1 хобби-сообщество, B2 платный Telegram-канал, B3 производитель с дилерами, B4 оптовик, B5 агентство B2B, B6 организатор мероприятий, B7 промышленный B2B, или null.",
    "observation — одно короткое наблюдение-крючок для первого сообщения, только из фактов (пример: «заказы принимаете только по телефону, сайта нет»).",
    "avgCheckRub и lostPerMonth — твоя осторожная оценка среднего чека в рублях и числа потерянных заявок в месяц для этой ниши, или null.",
    "repeatable — повторяемый ли процесс (бронь, заказы, каталог) true/false/null. microBusiness, irrelevant, goodSiteAlready — true/false.",
    "features — 3 фишки решения под эту нишу (например: корзина и оплата, онлайн-запись, прайс с ценами).",
    "Поля JSON: segment, observation, money{facts}, chaos{facts}, growth{facts}, repeatable, microBusiness, irrelevant, goodSiteAlready, avgCheckRub, lostPerMonth, features.",
  ].join(" ");
  const user = JSON.stringify({ instruction: "Разбери только эти поля.", facts });
  return { system, user };
}
