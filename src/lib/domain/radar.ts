import { z } from "zod";

/**
 * Радар намерений (сценарии 3 и 4 брифа): чистая логика без базы и сети.
 *  • фильтр по ключевым словам с простой морфологией (стеммер русских окончаний) и минус-словам;
 *  • разбор JSON модели (намерение, город, район, срок, бюджет, балл, суть, подсказка ответа) — без факта null;
 *  • понижение похожих на то, что человек отметил «Не то».
 */

/* ───────────── Морфология ───────────── */

/** Частые формы глаголов запроса, которые стеммер окончаний не сводит к одной основе. */
const IRREGULAR: Record<string, string> = {
  ищу: "иск", ищем: "иск", ищет: "иск", ищут: "иск", ищете: "иск", ищешь: "иск", искать: "иск", поищу: "иск", поиск: "иск", поиски: "иск", поиска: "иск", поиске: "иск", ищется: "иск",
  нужен: "нуж", нужна: "нуж", нужно: "нуж", нужны: "нуж", надо: "нуж", нужда: "нуж",
  сниму: "сним", снимем: "сним", снять: "сним", снимаю: "сним", снимать: "сним", снимет: "сним", снимут: "сним",
  сдам: "сда", сдаю: "сда", сдаем: "сда", сдается: "сда", сдаётся: "сда", сдать: "сда", сдаём: "сда", сдают: "сда", сдаются: "сда",
  куплю: "куп", купим: "куп", купить: "куп", покупка: "куп", покупку: "куп",
  продам: "прода", продаю: "прода", продажа: "прода", продажу: "прода", продать: "прода",
};

const REFLEXIVE = ["ся", "сь"];
/** Окончания по убыванию длины: прилагательные, причастия, глаголы, существительные. */
const ENDINGS = [
  "ировать", "ировали", "ированный", "овать", "евать", "ывать", "ивать",
  "ейшего", "ейшему", "ейшими", "ующего", "ующему", "ующими",
  "иями", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими", "ешь", "ете", "ите", "ала", "яла", "ила", "ела", "ило", "али", "или", "ать", "ять", "ить", "еть", "уть", "ием", "иях", "ией",
  "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ой", "ую", "юю", "ом", "ем", "ым", "им", "ых", "их", "ах", "ях", "ов", "ев", "ей", "ам", "ям", "ию", "ья", "ье", "ьи", "ия", "ие", "ет", "ют", "ут", "ит", "ят", "ла", "ло", "ли", "ть",
  "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й",
];
const MIN_STEM = 3;

export function normalizeText(text: string) {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]+/gi, " ").replace(/\s+/g, " ").trim();
}

export function stem(word: string): string {
  let value = word.toLowerCase().replace(/ё/g, "е");
  if (IRREGULAR[value]) return IRREGULAR[value];
  if (!/[а-я]/.test(value)) return value;
  for (const ending of REFLEXIVE) {
    if (value.length - ending.length >= MIN_STEM + 1 && value.endsWith(ending)) {
      value = value.slice(0, -ending.length);
      break;
    }
  }
  if (IRREGULAR[value]) return IRREGULAR[value];
  for (const ending of ENDINGS) {
    if (value.length - ending.length >= MIN_STEM && value.endsWith(ending)) return value.slice(0, -ending.length);
  }
  return value;
}

/** Служебные слова не участвуют в совпадении фразы («склад под производство» = «склад» + «производство»). */
const STOP = new Set(["в", "во", "на", "под", "для", "по", "с", "со", "и", "или", "а", "от", "до", "из", "к", "ко", "у", "о", "об", "за", "при", "не", "то", "же", "ли", "бы", "мне", "нам", "кто", "что", "как", "это", "так"]);

export function tokens(text: string): string[] {
  return normalizeText(text).split(" ").filter((word) => word && !STOP.has(word));
}

export function stems(text: string): string[] {
  return tokens(text).map(stem);
}

function stemHit(tokenStem: string, wordStem: string) {
  if (tokenStem === wordStem) return true;
  // Основа ключа — начало основы слова («склад» ↔ «складск-ое»), но не наоборот и не для коротких основ.
  return wordStem.length >= 4 && tokenStem.startsWith(wordStem);
}

/** Насколько далеко друг от друга могут стоять слова фразы (в значимых словах). */
const PHRASE_WINDOW = 6;

/**
 * Слово или фраза: все значимые слова фразы встречаются в тексте в любой форме и стоят рядом
 * (в окне PHRASE_WINDOW слов) — иначе длинный рекламный пост с «поиском» в начале и «помещением» в конце
 * проходил бы как запрос.
 */
export function phraseMatches(textStems: string[], phrase: string) {
  const words = stems(phrase);
  if (!words.length) return false;
  const positions = words.map((word) => textStems.flatMap((item, index) => (stemHit(item, word) ? [index] : [])));
  if (positions.some((list) => !list.length)) return false;
  if (words.length === 1) return true;
  const window = Math.max(PHRASE_WINDOW, words.length * 2);
  // Для каждой позиции первого слова ищем остальные слова в пределах окна.
  return positions[0].some((start) => positions.slice(1).every((list) => list.some((index) => Math.abs(index - start) <= window)));
}

export type KeywordVerdict = { pass: boolean; matched: string[]; blockedBy: string | null };

/** Фильтр по словам: хотя бы одна ключевая фраза и ни одного минус-слова. Пустой список ключей — пропускаем всё (решает модель). */
export function keywordFilter(text: string, keywords: string[], minusWords: string[] = []): KeywordVerdict {
  const textStems = stems(text);
  const blockedBy = minusWords.find((word) => word.trim() && phraseMatches(textStems, word)) ?? null;
  const clean = keywords.map((item) => item.trim()).filter(Boolean);
  const matched = clean.filter((phrase) => phraseMatches(textStems, phrase));
  return { pass: !blockedBy && (clean.length === 0 || matched.length > 0) && textStems.length > 1, matched, blockedBy };
}

/** Ввод списка слов: по строкам или через запятую, без пустых и повторов. */
export function parseWordList(value: string | string[]): string[] {
  const list = Array.isArray(value) ? value : value.split(/[\n,;]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const item = raw.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out.slice(0, 100);
}

/* ───────────── «Не то» → понижение похожих ───────────── */

function contentStems(text: string) {
  return new Set(stems(text).filter((item) => item.length >= 3 && !/^\d+$/.test(item)));
}

/** Доля общих значимых основ относительно меньшего из двух сообщений (0–1). */
export function similarity(a: string, b: string) {
  const left = contentStems(a);
  const right = contentStems(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common += 1;
  return common / Math.min(left.size, right.size);
}

/** Штраф к баллу за сходство с примерами «Не то»: от 0 до 60. Ниже 0,35 сходства — не трогаем. */
export function rejectPenalty(text: string, rejected: string[]) {
  let best = 0;
  for (const example of rejected) best = Math.max(best, similarity(text, example));
  if (best < 0.35) return 0;
  return Math.min(60, Math.round(best * 70));
}

export function finalScore(modelScore: number, penalty: number) {
  return Math.max(0, Math.min(100, Math.round(modelScore) - penalty));
}

/* ───────────── Ответ модели ───────────── */

export const RADAR_INTENTS = ["request", "offer", "ad", "other"] as const;
export type RadarIntent = (typeof RADAR_INTENTS)[number];
export const INTENT_LABEL: Record<RadarIntent, string> = { request: "ищет", offer: "предлагает", ad: "реклама", other: "другое" };

const EMPTY = /^(null|none|n\/a|nan|not_found|нет|не указан[оа]?|не указаны|неизвестно|не известно|нет данных|-|—)$/i;

function nullable(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || EMPTY.test(text)) return null;
  return text.slice(0, 400);
}

const RU_KEYS: Record<string, string> = {
  намерение: "intent", город: "city", район: "district", срок: "deadline", срочность: "deadline", бюджет: "budget", балл: "score", суть: "summary", подсказка_ответа: "reply", подсказка: "reply", ответ: "reply",
};

const INTENT_ALIASES: Record<string, RadarIntent> = {
  request: "request", demand: "request", need: "request", запрос: "request", ищет: "request", спрос: "request", ищу: "request",
  offer: "offer", supply: "offer", предложение: "offer", предлагает: "offer", сдает: "offer", сдаёт: "offer", продает: "offer",
  ad: "ad", spam: "ad", advertising: "ad", реклама: "ad", спам: "ad",
  other: "other", другое: "other", прочее: "other", none: "other",
};

export const radarResultSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) out[RU_KEYS[key.toLowerCase()] ?? key] = value;
    return out;
  },
  z.object({
    intent: z.preprocess((value) => INTENT_ALIASES[String(value ?? "").trim().toLowerCase()] ?? "other", z.enum(RADAR_INTENTS)),
    city: z.unknown().transform(nullable),
    district: z.unknown().transform(nullable),
    deadline: z.unknown().transform(nullable),
    budget: z.unknown().transform(nullable),
    score: z.preprocess((value) => {
      const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.]/g, ""));
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
    }, z.number()),
    summary: z.unknown().transform(nullable),
    reply: z.unknown().transform(nullable),
  }),
);
export type RadarResult = z.infer<typeof radarResultSchema>;

/** Разбор ответа модели: JSON (в т. ч. в ```json```), русские или английские ключи. Мусор — исключение. */
export function parseRadarJson(text: string): RadarResult {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("В ответе модели нет JSON");
  return radarResultSchema.parse(JSON.parse(trimmed.slice(start, end + 1)));
}

export function buildRadarPrompt(input: { projectName: string; kind: string; target: string | null; keywords: string[]; chatTitle: string; text: string; rejected: string[] }) {
  const forClient = input.kind === "client";
  const system = [
    "Ты разбираешь сообщения из открытых Telegram-чатов и ищешь людей с живым запросом.",
    `Проект: «${input.projectName}». ${forClient ? "Это радар для заказчика: ответ автору напишет заказчик сам." : "Это радар студии neeklo (сайты, Mini App, анимация и ИИ-видео): ответ автору напишет менеджер студии сам."}`,
    input.target ? `Кого ищем: ${input.target}` : `Кого ищем: людей, которые сами ищут то, что связано со словами: ${input.keywords.slice(0, 20).join(", ")}.`,
    "intent: request — автор сам ищет/хочет купить/снять/заказать; offer — автор предлагает свою услугу или объект (сдаёт, продаёт, оказывает); ad — реклама, рассылка, бот; other — всё остальное.",
    "score 0–100: насколько это горячий запрос именно для проекта (request по теме со сроком или бюджетом — 70–100; request не совсем по теме — 30–60; offer/ad/other — 0–20).",
    "Поля city, district, deadline, budget — только если они прямо есть в тексте; иначе null. Ничего не выдумывай.",
    "summary — суть запроса одной фразой до 20 слов, без оценок.",
    "reply — черновик личного сообщения автору до 60 слов от первого лица: зацепись за его запрос, задай один уточняющий вопрос. Без цен, сроков, ссылок, обещаний и выдуманных кейсов. Если intent не request — null.",
    "Ответ — строго JSON: {\"intent\":\"request|offer|ad|other\",\"city\":null,\"district\":null,\"deadline\":null,\"budget\":null,\"score\":0,\"summary\":\"...\",\"reply\":null}",
  ].join("\n");
  const rejected = input.rejected.slice(0, 5).map((item) => `- ${item.replace(/\s+/g, " ").slice(0, 240)}`);
  const user = [
    rejected.length ? `Заказчик отметил «Не то» на таких сообщениях — похожим ставь низкий балл:\n${rejected.join("\n")}\n` : "",
    `Чат: ${input.chatTitle}`,
    `Сообщение:\n${input.text.slice(0, 2500)}`,
  ].join("\n");
  return { system, user };
}

/** Без модели (OpenRouter не подключён): балл только по словам, без выдумок. */
export function keywordOnlyResult(text: string, matched: string[]): RadarResult {
  return { intent: "other", city: null, district: null, deadline: null, budget: null, score: Math.min(60, 30 + matched.length * 10), summary: text.replace(/\s+/g, " ").slice(0, 160), reply: null };
}

/* ───────────── Ссылки на чаты ───────────── */

/**
 * @username, t.me/username, https://t.me/username/123 → username.
 * Приглашения (t.me/+..., joinchat) — закрытые чаты: возвращаем null, радар их не читает.
 */
export function parseChatRef(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/joinchat|t\.me\/\+|^\+/i.test(value)) return null;
  const link = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([A-Za-z0-9_]{4,32})(?:[/?#].*)?$/i.exec(value);
  const raw = link ? link[1] : value.replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(raw) ? raw : null;
}

export function messageLink(username: string, messageId: number) {
  return `https://t.me/${username.replace(/^@/, "")}/${messageId}`;
}

export function authorChatLink(username: string | null | undefined) {
  return username ? `https://t.me/${username.replace(/^@/, "")}` : null;
}

/** Только открытые группы и каналы с публичным @username. Люди, боты и закрытые — нет. */
export function readablePeer(peer: { type: string; username: string | null }) {
  return Boolean(peer.username) && ["channel", "group", "supergroup", "megagroup", "gigagroup"].includes(peer.type);
}

/* ───────────── Тексты для бота заказчика ───────────── */

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type FindingView = {
  summary: string | null;
  text: string;
  city: string | null;
  district: string | null;
  deadline: string | null;
  budget: string | null;
  score: number;
  link: string | null;
  chatTitle: string;
  authorUsername: string | null;
  authorName: string | null;
  reply: string | null;
};

export function findingMessage(finding: FindingView) {
  const place = [finding.city, finding.district].filter(Boolean).join(", ");
  const lines = [
    `🔥 <b>${finding.score}/100</b> · ${escapeHtml(finding.chatTitle)}`,
    `<b>${escapeHtml(finding.summary ?? finding.text.slice(0, 160))}</b>`,
    place ? `📍 ${escapeHtml(place)}` : "",
    finding.deadline ? `⏱ ${escapeHtml(finding.deadline)}` : "",
    finding.budget ? `💰 ${escapeHtml(finding.budget)}` : "",
    "",
    `<i>${escapeHtml(finding.text.replace(/\s+/g, " ").slice(0, 600))}</i>`,
    "",
    finding.authorUsername ? `Автор: @${escapeHtml(finding.authorUsername)}` : finding.authorName ? `Автор: ${escapeHtml(finding.authorName)} (без @username — ответить можно в чате)` : "",
    finding.link ? `<a href="${escapeHtml(finding.link)}">Оригинал сообщения</a>` : "",
    finding.reply ? `\nПодсказка ответа:\n<code>${escapeHtml(finding.reply)}</code>` : "",
  ];
  return lines.filter((line, index, all) => line !== "" || (all[index - 1] ?? "") !== "").join("\n").slice(0, 4000);
}

export function weeklyReportText(input: { projectName: string; from: Date; to: Date; total: number; taken: number; rejected: number; later: number; fresh: number; topChats: { title: string; count: number }[] }) {
  const day = (value: Date) => value.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
  const chats = input.topChats.slice(0, 5).map((item) => `• ${escapeHtml(item.title)} — ${item.count}`);
  return [
    `📊 <b>Радар «${escapeHtml(input.projectName)}»: неделя ${day(input.from)} – ${day(input.to)}</b>`,
    `Запросов найдено: ${input.total}`,
    `Взяли: ${input.taken} · Не то: ${input.rejected} · Позже: ${input.later} · Без ответа: ${input.fresh}`,
    input.total ? `Точность (взяли из разобранных): ${Math.round((input.taken / Math.max(1, input.taken + input.rejected)) * 100)}%` : "",
    chats.length ? `\nГде больше всего запросов:\n${chats.join("\n")}` : "",
    "\n«Не то» учитывается: похожие сообщения получают меньший балл.",
  ].filter(Boolean).join("\n");
}

/** callback_data кнопок бота: r:<действие>:<id находки> (до 64 байт). */
export function callbackData(action: "take" | "reject" | "later", findingId: string) {
  return `r:${action[0]}:${findingId}`;
}

export function parseCallback(data: string | undefined): { action: "take" | "reject" | "later"; findingId: string } | null {
  const match = /^r:([trl]):([a-z0-9]{10,40})$/.exec(data ?? "");
  if (!match) return null;
  return { action: match[1] === "t" ? "take" : match[1] === "r" ? "reject" : "later", findingId: match[2] };
}
