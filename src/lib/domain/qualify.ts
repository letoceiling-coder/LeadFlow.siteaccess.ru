import { z } from "zod";
import { detectSegment, isSegment, segmentInfo, type SegmentId } from "./segments";

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
};

export type CardFact = { text: string; source: string; kind: "fact" | "assumption" };

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

function cleanFacts(list: { text: string; source: string }[], allowed: Set<string>): CardFact[] {
  const seen = new Set<string>();
  const out: CardFact[] = [];
  for (const item of list) {
    if (!allowed.has(item.source)) continue;
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
  const money = cleanFacts(ai?.money.facts ?? [], allowed);
  const chaos = cleanFacts(ai?.chaos.facts ?? [], allowed);
  const growth = cleanFacts(ai?.growth.facts ?? [], allowed);

  if ((facts.reviewCount ?? 0) >= 100 && !money.some((item) => item.source === "reviewCount")) {
    money.push({ text: `${facts.reviewCount} отзывов`, source: "reviewCount", kind: "fact" });
  }
  if (facts.websiteStatus === "NO_WEBSITE" && !chaos.some((item) => item.source === "websiteStatus" || item.source === "website")) {
    chaos.push({ text: "Нет своего сайта — только карточка на картах", source: "websiteStatus", kind: "fact" });
  }

  const aiSegment = ai?.segment && isSegment(ai.segment) ? ai.segment : null;
  const segment = aiSegment ?? detectSegment(facts.category, facts.categories);

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
  const observation = ai?.observation?.trim() || (noSite ? "у вас нет своего сайта, клиенты находят вас только на картах" : chaos[0]?.text) || null;
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
  };
}

export function rub(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

/** Скоринг 0–100 по §4. */
export function strategyScore(card: ObservationCard, ai: QualifyResult | null) {
  const hasContact = card.contact.length > 0;
  const factors: StrategyFactor[] = [];
  const push = (key: string, label: string, points: number, hit: boolean, reason: string) =>
    factors.push({ key, label, points: hit ? points : 0, hit, reason });

  push("money", "Признак денег", 30, card.money.length > 0, card.money.map((item) => item.text).join("; ") || "Подтверждённого признака денег нет");
  push("chaos", "Явный хаос", 25, card.chaos.length > 0, card.chaos.map((item) => item.text).join("; ") || "Подтверждённого хаоса нет");
  push("repeatable", "Повторяемый процесс", 15, ai?.repeatable === true, ai?.repeatable == null ? "Не оценивалось" : ai.repeatable ? "Бронь, каталог, заказы — повторяются" : "Разовая услуга");
  push("contact", "Публичный контакт", 15, hasContact, hasContact ? `${card.contact.length} контакт(ов) в источнике` : "Контактов нет");
  push("growth", "Признаки роста", 10, card.growth.length > 0, card.growth.map((item) => item.text).join("; ") || "Не найдено");
  push("case", "Есть кейс NEEKLO", 10, Boolean(card.caseRef), card.caseRef ?? "Кейса под эту нишу нет");
  push("micro", "Микробизнес", -30, ai?.microBusiness === true, "Похоже на микробизнес без оборота");
  push("goodSite", "Уже есть хороший сайт", -40, ai?.goodSiteAlready === true, "Есть сайт с формой, записью или каталогом");
  push("noContact", "Нет контакта", -15, !hasContact, "Нет публичного контакта");
  push("irrelevant", "Нерелевант или спам", -50, ai?.irrelevant === true, "Карточка нерелевантна");

  const score = Math.max(0, Math.min(100, factors.reduce((sum, item) => sum + item.points, 0)));
  const ready = card.money.length > 0 && card.chaos.length > 0 && hasContact;
  return { score, factors, ready, priority: priorityOf(score, ready) };
}

export type Priority = "A" | "B" | "C" | "D";

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
