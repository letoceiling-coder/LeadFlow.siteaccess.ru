/**
 * Дедупликация организаций между источниками (карты, Telegram, MAX, ручные): одна компания — одна карточка.
 * Ключи: домен сайта, телефон, @username Telegram, нормализованное «название + город».
 * Чистые функции: сервис по ним ищет совпадения в базе, тесты проверяют правила.
 */
import { normalizePhone, normalizeUsername, siteDomain } from "./telegram-facts";

export type DedupeInput = {
  name?: string | null;
  city?: string | null;
  website?: string | null;
  phones?: string[];
  usernames?: string[];
  /** Контакты карточки как есть (type/value из OrganizationContact). */
  contacts?: { type: string; value: string }[];
};

export type DedupeKeys = { domains: string[]; phones: string[]; usernames: string[]; nameCity: string | null };

/** Домены, по которым совпадение ничего не значит (у тысяч организаций одинаковые). */
const SHARED_DOMAINS = /(^|\.)(vk\.ru|vk\.link|rutube\.ru|dzen\.ru|nspk\.ru|timepad\.ru|t\.me|telegram\.me|vk\.com|vk\.me|ok\.ru|instagram\.com|facebook\.com|youtube\.com|youtu\.be|wa\.me|max\.ru|taplink\.cc|linktr\.ee|tilda\.ws|ucoz\.ru|narod\.ru|wixsite\.com|business\.site|yandex\.ru|google\.com|2gis\.ru|zoon\.ru|avito\.ru|dobro\.ru|mos\.ru|gosuslugi\.ru|culture\.ru|tiu\.ru|blogspot\.com)$/i;

const LEGAL = /(?<![a-zа-я0-9])(ооо|оао|зао|пао|ао|ип|ано|нко|бф|бо|мбук|гбук|гаук|мбу|гбу|фгбук|фгбу|чу|нп|роо|мро|фонд поддержки|благотворительный фонд|фонд|благотворительная организация|автономная некоммерческая организация|музей|официальный канал|официальный)(?![a-zа-я0-9])/giu;

/** Название для сравнения: без формы собственности, кавычек, регистра, «ё», пунктуации и эмодзи. */
export function normalizeOrgName(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„'`]/g, " ")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCity(city: string | null | undefined) {
  return (city || "").toLowerCase().replace(/ё/g, "е").replace(/^(г\.?|город)\s+/, "").trim();
}

export function dedupeKeys(input: DedupeInput): DedupeKeys {
  const domains = new Set<string>();
  const phones = new Set<string>();
  const usernames = new Set<string>();
  const addDomain = (value: string | null | undefined) => {
    const domain = siteDomain(value);
    if (domain && !SHARED_DOMAINS.test(domain)) domains.add(domain);
  };
  addDomain(input.website);
  for (const phone of input.phones ?? []) {
    const value = normalizePhone(phone);
    if (value) phones.add(value);
  }
  for (const name of input.usernames ?? []) {
    const value = normalizeUsername(name);
    if (value) usernames.add(value);
  }
  for (const contact of input.contacts ?? []) {
    if (contact.type === "phone") {
      const value = normalizePhone(contact.value);
      if (value) phones.add(value);
    } else if (contact.type === "telegram" || /t\.me\/|telegram\.me\//i.test(contact.value)) {
      const value = normalizeUsername(contact.value);
      if (value) usernames.add(value);
    } else if (contact.type === "website") addDomain(contact.value);
  }
  const name = normalizeOrgName(input.name);
  const city = normalizeCity(input.city);
  // Слишком короткое название («Дом», «Центр») совпадёт случайно — по нему не склеиваем.
  const nameCity = name.replace(/\s/g, "").length >= 5 && city ? `${name}|${city}` : null;
  return { domains: [...domains], phones: [...phones], usernames: [...usernames], nameCity };
}

export type DedupeMatch = { by: "domain" | "phone" | "telegram" | "name"; value: string };

/** Совпадают ли две карточки. Возвращает первый совпавший ключ (самый надёжный первым). */
export function sameOrganization(left: DedupeKeys, right: DedupeKeys): DedupeMatch | null {
  const common = (a: string[], b: string[]) => a.find((item) => b.includes(item));
  const username = common(left.usernames, right.usernames);
  if (username) return { by: "telegram", value: username };
  const domain = common(left.domains, right.domains);
  if (domain) return { by: "domain", value: domain };
  const phone = common(left.phones, right.phones);
  if (phone) return { by: "phone", value: phone };
  if (left.nameCity && left.nameCity === right.nameCity) return { by: "name", value: left.nameCity };
  return null;
}

/** Самое длинное слово названия — для грубого отбора кандидатов в базе перед точной проверкой. */
export function nameProbe(name: string | null | undefined): string | null {
  const words = normalizeOrgName(name).split(" ").filter((word) => word.length >= 4);
  if (!words.length) return null;
  return words.sort((a, b) => b.length - a.length)[0];
}

/** Последние 10 цифр телефона — так телефон ищется в базе независимо от формата записи. */
export function phoneTail(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}
