import { builderHost } from "./qualify";
import { siteIsGood, type SiteScan } from "./site-scan";
import type { PresetId } from "./segments";

/**
 * Досье карточки по брифу 27.11 (приложение A, шаги 3–4): сайт, каналы связи, последний пост, повод, зацепка и оценка A/B/C.
 * Чистые функции: без сети и базы, всё проверяется тестами.
 */

export const NOT_FOUND = "NOT_FOUND";

export type Post = { text: string; link: string | null; date: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Посты из `Organization.raw.telegram.posts` (контракт с S2). Минимальная версия `telegramFacts` с той же формой результата:
 * свежие сверху, только с текстом. После слияния её можно заменить на `telegramFacts` из `telegram-facts.ts`.
 */
export function postFacts(raw: unknown): Post[] {
  const posts = asRecord(asRecord(raw)?.telegram)?.posts;
  if (!Array.isArray(posts)) return [];
  return posts
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      text: typeof item.text === "string" ? item.text.replace(/\s+/g, " ").trim().slice(0, 600) : "",
      link: typeof item.link === "string" ? item.link : null,
      date: typeof item.date === "string" ? item.date : "",
    }))
    .filter((item) => item.text.length >= 20)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}

/** Юзернейм канала организации из raw.telegram — чтобы не путать канал с личным контактом владельца. */
export function channelUsername(raw: unknown): string | null {
  const name = asRecord(asRecord(raw)?.telegram)?.username;
  return typeof name === "string" && name.trim() ? name.trim().replace(/^@/, "").toLowerCase() : null;
}

/* ───────────── Сайт: нет, плохой или нормальный, и почему ───────────── */

export type SiteVerdict = { verdict: "none" | "weak" | "ok"; why: string };

export function siteVerdict(input: { websiteStatus: string; website: string | null; site: SiteScan | null }): SiteVerdict {
  const { websiteStatus, website, site } = input;
  if (websiteStatus === "NO_WEBSITE" || (!website && websiteStatus !== "WEBSITE_EXISTS")) return { verdict: "none", why: "Своего сайта нет — только карточка в источнике" };
  if (websiteStatus === "SOCIAL_ONLY") return { verdict: "none", why: "Вместо сайта — страница в соцсети" };
  if (websiteStatus === "AGGREGATOR_ONLY") return { verdict: "none", why: "Своего сайта нет — только агрегатор" };
  if (websiteStatus === "BROKEN_WEBSITE" || (site && !site.ok)) return { verdict: "weak", why: "Сайт из карточки не открывается" };
  const builder = builderHost(website);
  if (builder) return { verdict: "weak", why: `Сайт на бесплатном конструкторе (${builder})` };
  if (!site) return { verdict: "ok", why: "Сайт есть, но ещё не проверен" };
  if (siteIsGood(site)) return { verdict: "ok", why: "Сайт нормальный: адаптив, https, запись или корзина" };
  const misses = [!site.viewport && "не адаптирован под телефон", !site.https && "без https", !(site.booking || site.cart || site.form) && "нет записи, корзины и формы", site.copyrightYear && site.copyrightYear <= new Date().getFullYear() - 3 && `© ${site.copyrightYear}`].filter(Boolean) as string[];
  if (misses.length >= 2 || !(site.booking || site.cart || site.form)) return { verdict: "weak", why: `Сайт слабый: ${misses.join(", ")}` };
  return { verdict: "ok", why: misses.length ? `Сайт нормальный, но ${misses.join(", ")}` : "Сайт нормальный" };
}

/* ───────────── Каналы связи ───────────── */

export type Channel = {
  kind: "telegram" | "max" | "whatsapp" | "phone" | "email" | "vk" | "instagram" | "link";
  value: string;
  label: string;
  /** Прямой канал к владельцу: личный Telegram, MAX, WhatsApp или мобильный. Почта, городской и канал организации — нет. */
  direct: boolean;
};

export function digitsOf(phone: string) {
  return phone.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
}

/** Российский мобильный: +7 9xx. Городские номера ведут на ресепшен, а не к владельцу. */
export function isMobile(phone: string) {
  const d = digitsOf(phone);
  return d.length === 11 && d.startsWith("79");
}

function tgHandle(value: string): string | null {
  const v = value.trim();
  const at = v.match(/^@([a-z0-9_]{4,32})$/i);
  if (at) return at[1];
  const link = v.match(/(?:^|\/\/|\.)(?:t\.me|telegram\.me)\/(?!\+|joinchat|c\/|s\/)([a-z0-9_]{4,32})/i);
  return link ? link[1] : null;
}

export function channelsOf(contacts: { type: string; value: string }[], raw?: unknown): Channel[] {
  const own = channelUsername(raw);
  const out: Channel[] = [];
  for (const contact of contacts) {
    const value = contact.value.trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    if (contact.type === "phone") {
      if (digitsOf(value).length < 10) continue;
      out.push({ kind: "phone", value, label: value, direct: isMobile(value) });
    } else if (contact.type === "email") {
      out.push({ kind: "email", value, label: value, direct: false });
    } else if (contact.type === "telegram" || /t\.me\/|telegram\.me\/|^@/.test(lower)) {
      const handle = tgHandle(value);
      if (!handle) continue;
      const isChannel = own != null && handle.toLowerCase() === own;
      out.push({ kind: "telegram", value: handle, label: `@${handle}${isChannel ? " (канал)" : ""}`, direct: !isChannel });
    } else if (contact.type === "max" || /(^|\/\/)(www\.)?max\.ru\//.test(lower)) {
      out.push({ kind: "max", value: value.startsWith("http") ? value : `https://${value}`, label: "MAX", direct: true });
    } else if (/wa\.me\/|whatsapp/.test(lower)) {
      out.push({ kind: "whatsapp", value, label: "WhatsApp", direct: true });
    } else if (/vk\.com\/|vk\.me\//.test(lower)) {
      out.push({ kind: "vk", value, label: "VK", direct: false });
    } else if (/instagram\.com\//.test(lower)) {
      out.push({ kind: "instagram", value, label: "Instagram", direct: false });
    } else if (/^https?:\/\//.test(lower)) {
      out.push({ kind: "link", value, label: value.replace(/^https?:\/\//, "").slice(0, 40), direct: false });
    }
  }
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(`${item.kind}:${item.value.toLowerCase()}`) ? false : (seen.add(`${item.kind}:${item.value.toLowerCase()}`), true)));
}

export type ChatTarget = { channel: "telegram" | "max"; label: string; href: string | null; hint: string | null };

/**
 * Куда открыть чат по кнопке «Скопировать и открыть чат»: личный Telegram → MAX по ссылке → Telegram по мобильному → канал организации.
 * MAX без ссылки — только копирование с подсказкой (у MAX нет публичной ссылки на чат по номеру).
 */
export function chatTargets(channels: Channel[]): ChatTarget[] {
  const out: ChatTarget[] = [];
  for (const item of channels.filter((c) => c.kind === "telegram" && c.direct)) out.push({ channel: "telegram", label: `Telegram @${item.value}`, href: `https://t.me/${item.value}`, hint: null });
  for (const item of channels.filter((c) => c.kind === "max")) out.push({ channel: "max", label: "MAX", href: item.value, hint: null });
  for (const item of channels.filter((c) => c.kind === "phone" && c.direct)) {
    out.push({ channel: "telegram", label: `Telegram по номеру ${item.value}`, href: `https://t.me/+${digitsOf(item.value)}`, hint: "Если номер скрыт в Telegram, чат не откроется — попробуйте MAX." });
    out.push({ channel: "max", label: `MAX ${item.value}`, href: null, hint: "Текст скопирован. Откройте MAX, найдите контакт по номеру и вставьте." });
  }
  for (const item of channels.filter((c) => c.kind === "telegram" && !c.direct)) out.push({ channel: "telegram", label: `Канал @${item.value} — найти контакт в описании`, href: `https://t.me/${item.value}`, hint: "Это канал, а не человек: контакт для связи обычно в описании." });
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(item.label) ? false : (seen.add(item.label), true)));
}

/* ───────────── Повод и зацепка ───────────── */

const REASONS: [RegExp, string][] = [
  [/сбор |собираем|объявляем сбор|помогите|благотворительн(ый|ая) (акци|ярмарк|концерт)|выставк[аи] откры|открыли выставк/i, "Сбор или событие"],
  [/открыл[иа]? (новую|новый|ещё|еще|второй|вторую|третий|филиал|точк|магазин|кафе|салон|офис|шоурум|цех)|новая точка|новый филиал|новый адрес|переехал|переезд/i, "Новая точка или переезд"],
  [/ваканси|ищем (в команду|сотрудник|менеджер|мастер|повар|курьер)|требу[ею]тся|в команду нужен/i, "Вакансия: компания растёт"],
  [/запуск|запустили|новинк|новая (модель|линейка|коллекция)|представляем/i, "Запуск или новинка"],
];

export function reasonOf(posts: Post[], growth: { text: string }[] = []): { text: string; source: string } | null {
  for (const post of posts.slice(0, 5)) {
    for (const [re, label] of REASONS) if (re.test(post.text)) return { text: `${label}: ${shortText(post.text, 14)}`, source: post.link ?? "пост" };
  }
  const grow = growth[0];
  return grow ? { text: grow.text, source: "карточка" } : null;
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function shortText(text: string, words: number) {
  const list = text.replace(/\s+/g, " ").trim().split(" ");
  return list.length <= words ? list.join(" ") : `${list.slice(0, words).join(" ")}…`;
}

/** Все числа зацепки должны быть в источнике: «12 лет» при «работаем с 2015» отбрасывается. */
function numbersIn(text: string, haystack: string) {
  const numbers = text.replace(/(\d)\s(?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) ?? [];
  const flat = haystack.replace(/\s/g, "");
  return numbers.every((num) => flat.includes(num) || flat.includes(num.replace(",", ".")));
}

/**
 * Зацепка от AI проходит проверку: 8–30 слов, без выдуманных чисел, не «нет сайта» при живом сайте.
 * Иначе — null (тогда пробуем зацепку из поста, а нет поста — NOT_FOUND).
 */
export function checkHook(hook: string | null | undefined, sourceText: string, hasSite: boolean): string | null {
  const text = (hook ?? "").replace(/\s+/g, " ").trim().replace(/^["«]|["»]$/g, "");
  if (!text || text.toUpperCase().includes(NOT_FOUND)) return null;
  const words = wordCount(text);
  if (words < 8 || words > 30) return null;
  if (!numbersIn(text, sourceText.toLowerCase())) return null;
  if (hasSite && /нет (своего |собственного )?сайта|без сайта|сайта нет/i.test(text)) return null;
  return text;
}

/** Зацепка без AI: свежий пост с датой. Это проверяемый факт — ссылка на пост рядом. */
export function hookFromPost(posts: Post[]): string | null {
  const post = posts[0];
  if (!post) return null;
  const date = post.date ? new Date(post.date) : null;
  const when = date && !Number.isNaN(date.getTime()) ? `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}` : null;
  return `В канале${when ? ` ${when}` : ""} написали: «${shortText(post.text, 14)}»`;
}

/* ───────────── Оценка A/B/C по правилу гайда ───────────── */

export type Grade = "A" | "B" | "C";

/**
 * A — есть зацепка, есть прямой канал к владельцу, сайта нет или он слабый (приложение A, шаг 4).
 * Для А и Б (видео, а не сайт) условие о сайте не проверяем: нормальный сайт фонду не мешает заказать ролик.
 * B — зацепка есть, но не хватает одного из двух; или нет зацепки, но прямой канал и слабый сайт.
 * C — остальное, а также федеральные сети и нерелевантные карточки.
 */
export function gradeOf(input: { hook: string | null; direct: boolean; site: SiteVerdict["verdict"]; preset: PresetId | null; blocked?: boolean }): { grade: Grade; why: string[] } {
  const hasHook = Boolean(input.hook && input.hook !== NOT_FOUND);
  const siteOk = input.preset === "А" || input.preset === "Б" ? true : input.site !== "ok";
  const why = [
    hasHook ? "есть зацепка" : "зацепки нет (NOT_FOUND)",
    input.direct ? "есть прямой канал к владельцу" : "нет прямого канала (только почта, городской или канал)",
    input.preset === "А" || input.preset === "Б" ? "сайт не важен для видео" : input.site === "ok" ? "сайт уже нормальный" : input.site === "weak" ? "сайт слабый" : "сайта нет",
  ];
  if (input.blocked) return { grade: "C", why: ["федеральная сеть или нерелевантно", ...why] };
  if (hasHook && input.direct && siteOk) return { grade: "A", why };
  const score = Number(hasHook) + Number(input.direct) + Number(siteOk);
  if ((hasHook && score >= 2) || (!hasHook && input.direct && siteOk)) return { grade: "B", why };
  return { grade: "C", why };
}

export type Dossier = {
  preset: PresetId | null;
  site: SiteVerdict;
  channels: Channel[];
  lastPost: Post | null;
  reason: { text: string; source: string } | null;
  /** 15–20 слов или NOT_FOUND. */
  hook: string;
  hookSource: "ai" | "post" | "reviews" | null;
  /** Тема для шаблона А/Б: «вы рассказываете про [тема] текстом и фото». */
  topic: string | null;
  grade: Grade;
  gradeWhy: string[];
};
