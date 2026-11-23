import { builderHost } from "./qualify";

/**
 * Скан сайта лида: из HTML страницы (парсер, page.html) достаём реальные контакты и признаки хаоса.
 * Чистая функция — без сети, чтобы её можно было покрыть тестами.
 */

export type SiteLink = { kind: "telegram" | "whatsapp" | "vk" | "max" | "instagram" | "ok" | "youtube" | "dzen" | "avito"; url: string };

export type SiteScan = {
  url: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  title: string | null;
  https: boolean;
  viewport: boolean;
  booking: boolean;
  cart: boolean;
  prices: boolean;
  form: boolean;
  builder: string | null;
  copyrightYear: number | null;
  loadMs: number | null;
  emails: string[];
  phones: string[];
  links: SiteLink[];
  scannedAt: string;
};

const LINK_RULES: { kind: SiteLink["kind"]; re: RegExp }[] = [
  { kind: "telegram", re: /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?!share)[A-Za-z0-9_+/-]{3,}/i },
  { kind: "whatsapp", re: /^https?:\/\/(?:wa\.me\/\d{6,}|(?:api|web)\.whatsapp\.com\/send\?[^"'\s]*phone=\d{6,}|chat\.whatsapp\.com\/[A-Za-z0-9]+)/i },
  { kind: "vk", re: /^https?:\/\/(?:m\.)?(?:vk\.com|vk\.me|vk\.ru)\/(?!share|away|widget|js|images|doc|video_ext)[A-Za-z0-9_.-]{2,}/i },
  { kind: "max", re: /^https?:\/\/(?:www\.)?max\.ru\/[A-Za-z0-9_/-]{3,}/i },
  { kind: "instagram", re: /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|accounts)[A-Za-z0-9_.]{2,}/i },
  { kind: "ok", re: /^https?:\/\/(?:www\.)?ok\.ru\/(?!dk\?)[A-Za-z0-9_/.-]{2,}/i },
  { kind: "youtube", re: /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)[A-Za-z0-9_.-]{2,}/i },
  { kind: "dzen", re: /^https?:\/\/(?:www\.)?dzen\.ru\/[A-Za-z0-9_.-]{2,}/i },
  { kind: "avito", re: /^https?:\/\/(?:www\.)?avito\.ru\/(?:brands|user)\/[A-Za-z0-9_.-]{2,}/i },
];

/** Конструкторы, которые видно по разметке, а не по домену (свой домен на Тильде, Wix и т. д.). */
const BUILDER_MARKERS: [RegExp, string][] = [
  [/tildacdn\.com|data-tilda-/i, "tilda"],
  [/static\.wixstatic\.com|wix\.com\/website/i, "wix"],
  [/clients\.site|business\.site/i, "clients.site"],
  [/taplink/i, "taplink"],
  [/nethouse/i, "nethouse"],
  [/ucoz|narod\.ru/i, "ucoz"],
  [/flexbe/i, "flexbe"],
  [/craftum/i, "craftum"],
  [/lpmotor|platformalp/i, "lpmotor"],
];

const BOOKING = /онлайн[- ]?запис|записаться онлайн|запись онлайн|выбрать время|свободное время|yclients|dikidi|sonline|bookform|онлайн[- ]?брон|забронировать|n\d+\.yclients|medods|prodoctorov\.ru\/.*appoint/i;
const CART = /в корзину|корзина|оформить заказ|добавить в заказ|cart|checkout|iiko|frontpad|tillypad/i;
const PRICES = /\d[\d\s]{1,7}\s?(?:₽|руб|р\.)|прайс|price-list|стоимость услуг/i;

function unique<T>(list: T[]) {
  return [...new Set(list)];
}

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&#64;|&commat;/g, "@").replace(/%40/g, "@");
}

const EMAIL = /[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,10}/g;
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|example|domain|mail\.example|email\.com$)|^(name|email|your|user|test)@|wixpress|sentry\.io/i;

/** Почта: сначала mailto, потом видимый текст. Убираем мусор из скриптов и картинок вида logo@2x.png. */
export function extractEmails(html: string, text: string): string[] {
  const fromMailto = [...decode(html).matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => m[1]);
  const fromText = decode(text).match(EMAIL) ?? [];
  return unique(
    [...fromMailto, ...fromText]
      .map((value) => value.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").toLowerCase())
      .filter((value) => /^[^@\s]+@[^@\s]+\.[a-z]{2,10}$/.test(value) && !JUNK_EMAIL.test(value)),
  ).slice(0, 5);
}

/** Телефоны из ссылок tel: — они надёжнее, чем цифры в тексте. Приводим к +7XXXXXXXXXX. */
export function extractPhones(html: string): string[] {
  const raw = [...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]);
  return unique(
    raw
      .map((value) => value.replace(/[^\d+]/g, ""))
      .map((value) => (value.length === 11 && value.startsWith("8") ? `+7${value.slice(1)}` : value.length === 11 && value.startsWith("7") ? `+${value}` : value))
      .filter((value) => value.replace(/\D/g, "").length >= 10),
  ).slice(0, 5);
}

/** Мессенджеры и соцсети из ссылок страницы. Кнопки «поделиться» отбрасываются. */
export function extractLinks(html: string): SiteLink[] {
  const hrefs = [...decode(html).matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1].trim());
  const out: SiteLink[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    for (const rule of LINK_RULES) {
      const match = href.match(rule.re);
      if (!match) continue;
      const url = match[0].replace(/[/?#]+$/, "");
      const key = url.toLowerCase();
      if (seen.has(key)) break;
      seen.add(key);
      out.push({ kind: rule.kind, url });
      break;
    }
  }
  return out.slice(0, 10);
}

export function copyrightYear(text: string): number | null {
  const years = [...text.matchAll(/(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
  const valid = years.filter((year) => year >= 2000 && year <= 2100);
  return valid.length ? Math.max(...valid) : null;
}

export function scanFromPage(input: { url: string; html: string; text: string; title?: string | null; httpStatus?: number | null; finalUrl?: string | null; loadMs?: number | null }, now = new Date()): SiteScan {
  const html = input.html ?? "";
  const text = input.text ?? "";
  const finalUrl = input.finalUrl || input.url;
  const lowerText = text.toLowerCase();
  const marker = BUILDER_MARKERS.find(([re]) => re.test(html))?.[1] ?? null;
  return {
    url: finalUrl,
    ok: (input.httpStatus ?? 200) < 400 && (html.length > 200 || text.length > 40),
    httpStatus: input.httpStatus ?? null,
    error: null,
    title: input.title?.trim().slice(0, 160) || null,
    https: finalUrl.startsWith("https://"),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    booking: BOOKING.test(html) || BOOKING.test(lowerText),
    cart: CART.test(lowerText) || /class=["'][^"']*\bcart\b/i.test(html) || ORDER_PLATFORMS.test(html),
    prices: PRICES.test(lowerText),
    form: /<form[\s>]/i.test(html) || /оставить заявку|обратный звонок|перезвоним/i.test(lowerText),
    builder: builderHost(finalUrl) ?? marker,
    copyrightYear: copyrightYear(text || html),
    loadMs: input.loadMs ?? null,
    emails: extractEmails(html, text),
    phones: extractPhones(html),
    links: extractLinks(html),
    scannedAt: now.toISOString(),
  };
}

/** Внешние сервисы заказа и записи: ссылка на них = корзина или запись у бизнеса уже есть. */
const ORDER_PLATFORMS = /eda\.yandex|market-delivery\.yandex|delivery-club|sbermarket|kuper\.ru|iiko|tillypad|frontpad|starterapp|foodsoul|yclients|dikidi|sonline|medods|prodoctorov|n\d+\.yclients/i;
const SUBPAGE_TEXT = /меню|доставк|заказ|цен[аы]|прайс|запис|услуг|каталог|бронир/i;

/** До двух внутренних страниц, где обычно живут меню, цены и запись. Главная часто — просто витрина. */
export function subpageLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const out: string[] = [];
  for (const m of decode(html).matchAll(/<a[^>]+href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, " ").trim();
    if (!SUBPAGE_TEXT.test(label)) continue;
    try {
      const url = new URL(m[1], base);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      const clean = `${url.origin}${url.pathname}`.replace(/\/$/, "");
      if (clean === `${base.origin}${base.pathname}`.replace(/\/$/, "") || out.includes(clean)) continue;
      out.push(clean);
    } catch { /* битая ссылка */ }
    if (out.length >= 2) break;
  }
  return out;
}

/** Склеивает скан главной со сканами внутренних страниц: признак есть, если он есть хоть где-то. */
export function mergeScans(main: SiteScan, extra: SiteScan[]): SiteScan {
  const ok = extra.filter((item) => item.ok);
  if (!ok.length) return main;
  return {
    ...main,
    booking: main.booking || ok.some((item) => item.booking),
    cart: main.cart || ok.some((item) => item.cart),
    prices: main.prices || ok.some((item) => item.prices),
    form: main.form || ok.some((item) => item.form),
    emails: unique([...main.emails, ...ok.flatMap((item) => item.emails)]).slice(0, 5),
    phones: unique([...main.phones, ...ok.flatMap((item) => item.phones)]).slice(0, 5),
    links: [...main.links, ...ok.flatMap((item) => item.links)].filter((link, index, list) => list.findIndex((other) => other.url.toLowerCase() === link.url.toLowerCase()) === index).slice(0, 10),
  };
}

export function failedScan(url: string, error: string, now = new Date()): SiteScan {
  return { url, ok: false, httpStatus: null, error: error.slice(0, 200), title: null, https: url.startsWith("https://"), viewport: false, booking: false, cart: false, prices: false, form: false, builder: builderHost(url), copyrightYear: null, loadMs: null, emails: [], phones: [], links: [], scannedAt: now.toISOString() };
}

/** Ошибки, которые значат «сайта по факту нет», а не «временный сбой». */
export function isDeadSiteError(error: string) {
  return /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CERT|ERR_SSL|ENOTFOUND|404|410|ERR_ADDRESS_UNREACHABLE/i.test(error);
}

/** Признаки хаоса по скану сайта, с учётом ниши. Каждая строка — проверяемый факт со ссылкой на сайт. */
export function siteChaos(scan: SiteScan, segment: string | null, now = new Date()): string[] {
  if (!scan.ok) return scan.error && isDeadSiteError(scan.error) ? ["Сайт из карточки не открывается"] : [];
  const out: string[] = [];
  const needsBooking = ["A2", "A3", "A5", "A6"].includes(segment ?? "");
  const needsCart = ["A1", "A4"].includes(segment ?? "");
  if (!scan.viewport) out.push("Сайт не адаптирован под телефон");
  if (needsBooking && !scan.booking) out.push(segment === "A6" ? "На сайте нет онлайн-брони — только звонок или сообщение" : "На сайте нет онлайн-записи — только звонок");
  if (needsCart && !scan.cart) out.push("На сайте нет корзины — заказ только по телефону или в мессенджере");
  if (!scan.prices && (needsBooking || needsCart)) out.push("На сайте нет цен");
  if (!scan.form && !scan.booking && !scan.cart) out.push("На сайте нет формы заявки");
  if (scan.copyrightYear && scan.copyrightYear <= now.getFullYear() - 3) out.push(`Сайт не обновлялся с ${scan.copyrightYear} года`);
  if (!scan.https) out.push("Сайт без https — браузер помечает его небезопасным");
  return out.slice(0, 4);
}

/** Хороший сайт уже есть: открывается, адаптивный, с записью или корзиной, не конструктор. Такому клиенту продавать сайт поздно. */
export function siteIsGood(scan: SiteScan | null | undefined) {
  if (!scan?.ok) return false;
  return scan.viewport && scan.https && (scan.booking || scan.cart) && !scan.builder && !(scan.copyrightYear && scan.copyrightYear <= new Date().getFullYear() - 3);
}
