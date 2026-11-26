/**
 * Telegram-каналы организаций: факты из постов, контакты из описания и текста, отбор «похоже на организацию».
 * Чистые функции без сети и базы — их же использует квалификация (S1) через `telegramFacts(raw)`.
 */

export type TelegramPost = {
  id: number;
  date: string;
  text: string;
  link: string | null;
  /** Тип вложения: photo, video, document, webpage… (null — только текст). */
  media?: string | null;
  /** Пересланный чужой пост — не факт об организации. */
  forwarded?: boolean;
  /** Ссылки из разметки поста (скрытые под текстом) — для поиска сайта и контактов. */
  urls?: string[];
};
export type TelegramRaw = {
  username: string;
  title: string;
  members: number | null;
  about?: string | null;
  type?: string;
  posts: TelegramPost[];
  checkedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** raw.telegram из Organization.raw (или null, если канала нет). */
export function telegramRaw(raw: unknown): TelegramRaw | null {
  const tg = asRecord(asRecord(raw)?.telegram);
  if (!tg || typeof tg.username !== "string") return null;
  const posts = Array.isArray(tg.posts) ? tg.posts : [];
  return {
    username: tg.username,
    title: typeof tg.title === "string" ? tg.title : tg.username,
    members: typeof tg.members === "number" ? tg.members : null,
    about: typeof tg.about === "string" ? tg.about : null,
    type: typeof tg.type === "string" ? tg.type : undefined,
    checkedAt: typeof tg.checkedAt === "string" ? tg.checkedAt : undefined,
    posts: posts
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        id: Number(item.id) || 0,
        date: typeof item.date === "string" ? item.date : "",
        text: typeof item.text === "string" ? item.text : "",
        link: typeof item.link === "string" ? item.link : null,
        media: typeof item.media === "string" ? item.media : null,
        forwarded: item.forwarded === true,
      })),
  };
}

/**
 * Посты канала как факты для зацепки: свежие сверху, только с текстом, не длиннее 600 знаков.
 * Сигнатура — контракт с квалификацией (S1).
 */
export function telegramFacts(raw: unknown): { text: string; link: string | null; date: string }[] {
  const tg = telegramRaw(raw);
  if (!tg) return [];
  return tg.posts
    .filter((post) => !post.forwarded)
    .map((post) => ({ text: cleanText(post.text).slice(0, 600), link: post.link, date: post.date }))
    .filter((post) => post.text.length >= 20)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 10);
}

export function cleanText(text: string) {
  return text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/* ───────────── Контакты из текста ───────────── */

export type ExtractedContacts = { websites: string[]; usernames: string[]; phones: string[]; emails: string[] };

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /(?<![a-zа-яё0-9@.-])((?:https?:\/\/)?(?:www\.)?(?:[a-zа-яё0-9-]+\.)+(?:ru|рф|su|com|org|net|info|online|site|pro|io|me|moscow|spb|art|museum|fund|club|store|shop|space|tech|digital|media|team)(?:\/[^\s)»"'<>,]*)?)/giu;
const TG_LINK_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-z0-9_]{4,32})(?:\/\d+)?/gi;
const MENTION_RE = /(^|[^a-z0-9_@.\/])@([a-z][a-z0-9_]{3,31})\b/gi;
const PHONE_RE = /(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g;

/** Хосты, которые не сайт организации (соцсети, хостинги ссылок, площадки сборов). */
const NOT_SITE = /(^|\.)(vk\.ru|ria\.ru|tass\.ru|rbc\.ru|lenta\.ru|kommersant\.ru|iz\.ru|nspk\.ru|cloudtips\.ru|yoomoney\.ru|sberbank\.ru|sber\.ru|tbank\.ru|tinkoff\.ru|vtb\.ru|alfabank\.ru|dobro\.ru|mos\.ru|gosuslugi\.ru|timepad\.ru|culture\.ru|max\.ru|vkvideo\.ru|vk\.link|t\.me|telegram\.me|telegra\.ph|vk\.com|vk\.me|vk\.cc|ok\.ru|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|dzen\.ru|rutube\.ru|clck\.ru|bit\.ly|goo\.gl|wa\.me|max\.ru|taplink\.cc|linktr\.ee|forms\.gle|google\.com|yandex\.ru|mail\.ru|gmail\.com|ya\.ru|disk\.yandex\.ru|docs\.google\.com|apple\.com|play\.google\.com|wikipedia\.org)$/i;
/** Служебные ники Telegram, которые никогда не контакт организации. */
const SERVICE_USERNAMES = new Set(["joinchat", "addstickers", "share", "proxy", "socks", "addlist", "boost", "iv", "c", "s", "telegram", "botfather", "durov", "gmail", "mail", "yandex"]);

export function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits[0] === "9") return `+7${digits}`;
  return null;
}

export function normalizeUsername(value: string | null | undefined): string | null {
  const name = (value || "").trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z][a-z0-9_]{3,31}$/.test(name) && !SERVICE_USERNAMES.has(name) ? name : null;
}

/** Домен сайта без www и протокола (для дедупликации и показа). */
export function siteDomain(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function extractContacts(text: string, self?: string | null): ExtractedContacts {
  const source = text || "";
  const own = normalizeUsername(self);
  const emails = new Set<string>();
  const websites = new Map<string, string>();
  const usernames = new Set<string>();
  const phones = new Set<string>();

  for (const match of source.matchAll(EMAIL_RE)) emails.add(match[0].toLowerCase().replace(/\.$/, ""));
  const withoutEmails = source.replace(EMAIL_RE, " ");

  for (const match of withoutEmails.matchAll(TG_LINK_RE)) {
    const name = normalizeUsername(match[1]);
    if (name && name !== own) usernames.add(name);
  }
  for (const match of withoutEmails.matchAll(MENTION_RE)) {
    const name = normalizeUsername(match[2]);
    if (name && name !== own) usernames.add(name);
  }
  for (const match of withoutEmails.matchAll(URL_RE)) {
    const domain = siteDomain(match[1]);
    if (!domain || NOT_SITE.test(domain)) continue;
    // Кириллический домен показываем как написан («фонд.рф»), сравниваем — по punycode.
    const shown = match[1].replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
    if (!websites.has(domain)) websites.set(domain, `https://${shown}`);
  }
  for (const match of source.matchAll(PHONE_RE)) {
    const phone = normalizePhone(match[0]);
    if (phone) phones.add(phone);
  }
  return { websites: [...websites.values()], usernames: [...usernames], phones: [...phones], emails: [...emails] };
}

/** Сложить контакты из описания и постов. Описание важнее: его контакты идут первыми. */
export function mergeContacts(...parts: ExtractedContacts[]): ExtractedContacts {
  const uniq = (list: string[]) => [...new Set(list)];
  return {
    websites: uniq(parts.flatMap((part) => part.websites)),
    usernames: uniq(parts.flatMap((part) => part.usernames)),
    phones: uniq(parts.flatMap((part) => part.phones)),
    emails: uniq(parts.flatMap((part) => part.emails)),
  };
}

/**
 * Контакты для карточки. В постах упоминают кого угодно (гостей, партнёров), поэтому из постов берём
 * только то, что повторяется хотя бы дважды или стоит рядом со словами «пишите», «менеджер», «связь».
 */
export function channelContacts(about: string | null | undefined, posts: { text: string; urls?: string[] }[], self?: string | null): ExtractedContacts {
  const fromAbout = extractContacts(about || "", self);
  const counts = new Map<string, number>();
  const marked = new Set<string>();
  const perPost = posts.map((post) => extractContacts([post.text, ...(post.urls ?? [])].join("\n"), self));
  posts.forEach((post, index) => {
    const contacts = perPost[index];
    const keys = [...contacts.websites, ...contacts.usernames.map((u) => `@${u}`), ...contacts.phones, ...contacts.emails];
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    if (/(пиши|напиш|звони|связ|менеджер|контакт|по вопросам|заявк|сотрудничеств|реклам|предложени|администратор)/i.test(post.text)) {
      for (const key of keys) marked.add(key);
    }
  });
  const keep = (key: string) => (counts.get(key) ?? 0) >= 2 || marked.has(key);
  const fromPosts: ExtractedContacts = {
    websites: perPost.flatMap((c) => c.websites).filter(keep),
    usernames: perPost.flatMap((c) => c.usernames).filter((u) => keep(`@${u}`)),
    phones: perPost.flatMap((c) => c.phones).filter(keep),
    emails: perPost.flatMap((c) => c.emails).filter(keep),
  };
  const merged = mergeContacts(fromAbout, fromPosts);
  return { websites: merged.websites.slice(0, 3), usernames: merged.usernames.slice(0, 5), phones: merged.phones.slice(0, 3), emails: merged.emails.slice(0, 3) };
}

/** Сайт организации среди найденных: домен похож на ник или название канала (а не на СМИ, спонсора, платёжку). */
export function officialSite(websites: string[], username: string | null | undefined, title?: string | null): string | null {
  const handle = (username || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const titleLatin = translit(title || "").replace(/[^a-z0-9]/g, "");
  for (const site of websites) {
    const host = site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
    const root = rootHost(host);
    if (!root) continue;
    const label = translit(root.split(".").slice(0, -1).join("")).replace(/[^a-z0-9]/g, "");
    if (!label) continue;
    const related = (label.length >= 3 && (handle.includes(label) || (handle.length >= 4 && label.includes(handle)))) || commonRun(label, handle) >= 5 || commonRun(label, titleLatin) >= 5;
    if (related) return `https://${root}`;
  }
  return null;
}

/** Корневой домен: ticket.rusmuseum.ru → rusmuseum.ru (но museum.spb.ru остаётся целиком). */
function rootHost(host: string) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const secondLevel = /^(spb|msk|com|org|net|edu|gov|nov|nnov|kazan|ekb|perm|samara)$/;
  const keep = parts.length >= 3 && secondLevel.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

function commonRun(a: string, b: string) {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0;
      while (a[i + k] && a[i + k] === b[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  return best;
}

const TRANSLIT: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
function translit(text: string) {
  return text.toLowerCase().replace(/[а-яё]/g, (char) => TRANSLIT[char] ?? "");
}

/* ───────────── Досье ───────────── */

export type ChannelDossier = {
  lastPostAt: string | null;
  daysSinceLastPost: number | null;
  postsPerWeek: number | null;
  postsSeen: number;
  active: boolean;
  /** Сколько из просмотренных постов с видео и с фото — повод для зацепки «рассказываете текстом и фото». */
  media: { video: number; photo: number; textOnly: number };
  summary: string;
};

export function channelDossier(posts: { date: string; text: string; media?: string | null }[], now = new Date()): ChannelDossier {
  const media = {
    video: posts.filter((post) => /video|gif|round/i.test(post.media || "")).length,
    photo: posts.filter((post) => /photo|image/i.test(post.media || "")).length,
    textOnly: posts.filter((post) => !post.media || post.media === "webpage").length,
  };
  const dates = posts
    .map((post) => new Date(post.date).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a);
  if (!dates.length) return { lastPostAt: null, daysSinceLastPost: null, postsPerWeek: null, postsSeen: 0, active: false, media, summary: "Постов не видно" };
  const day = 24 * 60 * 60 * 1000;
  const last = dates[0];
  const since = Math.max(0, Math.floor((now.getTime() - last) / day));
  const span = Math.max(1, (last - dates[dates.length - 1]) / day);
  const perWeek = dates.length >= 2 ? Math.round(((dates.length - 1) / span) * 7 * 10) / 10 : null;
  const active = since <= 60;
  const freq = perWeek == null ? "один пост в выборке" : perWeek >= 7 ? "ежедневно" : perWeek >= 1 ? `≈${perWeek} поста в неделю` : `≈${Math.round(perWeek * 4.3 * 10) / 10} в месяц`;
  const when = since === 0 ? "сегодня" : since === 1 ? "вчера" : `${since} дн. назад`;
  const mix = `видео в ${media.video} из ${posts.length}`;
  return { lastPostAt: new Date(last).toISOString(), daysSinceLastPost: since, postsPerWeek: perWeek, postsSeen: dates.length, active, media, summary: `Последний пост ${when}, ${freq}, ${mix}` };
}

/* ───────────── Отбор каналов ───────────── */

export type PeerLike = { type: string; title: string; username: string | null; members?: number | null; verified?: boolean };

/** Слова в названии, по которым канал — не организация, а агрегатор, слив, барахолка и т. п. */
const JUNK_TITLE = /(подборк|агрегатор|складчин|слив|халяв|скидк|промокод|купон|барахолк|объявлени|вакансии|работа в|подработ|знакомств|чат\s|флуд|мемы|юмор|приколы|ставки|прогноз|казино|крипт|заработ|инвест|сигнал|бот(?![а-яёa-z0-9])|bot\b|рейтинг|топ[\s-]?\d|база\s|отзывы о|black ?list|скам)/i;
/** «Новости», «дайджест» — агрегатор, если в названии нет признаков организации («Новости фонда X» оставляем). */
const SOFT_JUNK_TITLE = /(новост|news|дайджест|digest|каталог|афиша)/i;
/** Слова, которые выдают организацию. */
const ORG_TITLE = /(фонд|музе|галере|выставк|центр|ано(?![а-яёa-z0-9])|нко|благотвор|театр|библиотек|школ|клиник|завод|компани|студи|ассоциаци|союз|общество|организаци|проект|помощ|приют|хоспис|дом(?![а-яёa-z0-9])|мастерск|производ|ооо|ип(?![а-яёa-z0-9])|«|")/i;

export type ChannelVerdict = { ok: boolean; score: number; reason: string };

export function judgeChannel(peer: PeerLike, niche: string, city?: string | null): ChannelVerdict {
  if (!peer.username) return { ok: false, score: 0, reason: "нет публичного имени" };
  if (!["channel", "supergroup", "group", "megagroup"].includes(peer.type)) return { ok: false, score: 0, reason: `тип ${peer.type}` };
  if (/bot$/i.test(peer.username)) return { ok: false, score: 0, reason: "бот" };
  const title = peer.title || "";
  if (JUNK_TITLE.test(title)) return { ok: false, score: 0, reason: "агрегатор/не организация" };
  if (SOFT_JUNK_TITLE.test(title) && !ORG_TITLE.test(title)) return { ok: false, score: 0, reason: "новостной агрегатор" };
  const members = peer.members ?? null;
  if (members != null && members < 30) return { ok: false, score: 0, reason: "меньше 30 подписчиков" };
  if (members != null && members > 300_000) return { ok: false, score: 0, reason: "медиа-гигант" };
  let score = 1;
  if (ORG_TITLE.test(title)) score += 2;
  const words = nicheWords(niche);
  if (words.some((word) => title.toLowerCase().includes(word))) score += 2;
  if (peer.type === "channel") score += 1;
  if (members != null && members >= 300 && members <= 50_000) score += 1;
  if (peer.verified) score += 1;
  // Город задан — местные каналы вперёд федеральных.
  if (city && mentionsCity(title, city)) score += 3;
  return { ok: true, score, reason: "похоже на организацию" };
}

/** Канал после чтения: живой ли и похож ли текст на организацию, а не на перепост новостей. */
export function judgeContent(about: string | null | undefined, posts: { date: string; text: string }[], now = new Date()): ChannelVerdict {
  const dossier = channelDossier(posts, now);
  if (!dossier.postsSeen) return { ok: false, score: 0, reason: "нет постов" };
  if (dossier.daysSinceLastPost != null && dossier.daysSinceLastPost > 365) return { ok: false, score: 0, reason: "не обновлялся больше года" };
  // Один пост с промокодом партнёра бывает и у фонда — отсеиваем, только если такого больше половины.
  const spam = posts.filter((post) => /(складчин|слив курс|промокод|казино|ставки на спорт|букмекер)/i.test(post.text)).length;
  if (/(складчин|казино|букмекер)/i.test(about || "") || (posts.length >= 2 && spam * 2 > posts.length)) return { ok: false, score: 0, reason: "реклама/складчина" };
  return { ok: true, score: dossier.active ? 2 : 1, reason: dossier.summary };
}

function stem(word: string) {
  return word.length > 5 ? word.slice(0, word.length - 2) : word;
}

export function nicheWords(niche: string) {
  return niche
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((word) => word.length >= 4 && !["город", "москва", "россия"].includes(word))
    .map(stem);
}

/** Синонимы ниш, по которым в Telegram реально называют каналы организаций. */
const SYNONYMS: { test: RegExp; phrases: string[] }[] = [
  { test: /благотвор|фонд|нко|некоммерч/i, phrases: ["благотворительный фонд", "фонд помощи", "благотворительная организация", "НКО", "фонд поддержки", "АНО помощь", "благотворительный проект", "помощь детям фонд"] },
  { test: /музе/i, phrases: ["музей", "музей официальный канал", "краеведческий музей", "музейный комплекс", "выставочный центр", "галерея", "музей-заповедник"] },
  { test: /выстав|галере/i, phrases: ["выставочный центр", "галерея", "выставка", "арт-пространство"] },
  { test: /театр/i, phrases: ["театр", "драматический театр", "театр официальный"] },
  { test: /производ|завод/i, phrases: ["завод", "производство", "производитель", "производственная компания"] },
  { test: /телекан|медиа/i, phrases: ["телеканал", "медиа холдинг", "телекомпания"] },
];

/**
 * Поисковые фразы из ниши: сама ниша, синонимы, с городом и без. Не больше `max` — каждый запрос
 * поиска тратит лимит аккаунта.
 */
export function searchPhrases(niche: string, city?: string | null, max = 12): string[] {
  const base = niche.trim().replace(/\s+/g, " ");
  const town = (city || "").trim();
  const synonyms = SYNONYMS.filter((item) => item.test.test(base)).flatMap((item) => item.phrases);
  const list: string[] = [];
  const add = (phrase: string) => {
    const value = phrase.trim().replace(/\s+/g, " ");
    if (value && !list.some((item) => item.toLowerCase() === value.toLowerCase())) list.push(value);
  };
  if (town) add(`${base} ${town}`);
  add(base);
  for (const phrase of synonyms) {
    if (town) add(`${phrase} ${town}`);
  }
  for (const phrase of synonyms) add(phrase);
  return list.slice(0, Math.max(1, max));
}

/** Упоминает ли канал город (для поля city карточки — только по факту, не по запросу). */
export function mentionsCity(text: string, city: string | null | undefined) {
  if (!city) return false;
  const word = city.toLowerCase().replace(/ё/g, "е").trim();
  if (word.length < 3) return false;
  const root = word.length > 5 ? word.slice(0, word.length - 2) : word;
  return text.toLowerCase().replace(/ё/g, "е").includes(root);
}
