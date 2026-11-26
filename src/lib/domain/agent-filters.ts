export const CONTACT_KINDS = ["email", "phone", "telegram", "vk", "max", "whatsapp", "instagram", "social"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export function normalizePlace(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function samePlace(left: string | null | undefined, right: string) {
  const a = normalizePlace(left || "");
  const b = normalizePlace(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

export function contactKinds(type: string, value: string): ContactKind[] {
  const kinds = new Set<ContactKind>();
  const text = value.toLowerCase();
  // «@username» с типом telegram — ник Telegram, а не почта.
  if (type === "email" || (type !== "telegram" && /[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(text))) kinds.add("email");
  if (type === "telegram") kinds.add("telegram");
  if (type === "phone") kinds.add("phone");
  if (/t\.me|telegram/.test(text)) kinds.add("telegram");
  if (/vk\.com|vk\.me|vkontakte/.test(text)) kinds.add("vk");
  if (/(^|\/\/|\.)max\.ru|oneme\.ru|web\.max/.test(text)) kinds.add("max");
  if (/wa\.me|whatsapp/.test(text)) kinds.add("whatsapp");
  if (/instagram\.com/.test(text)) kinds.add("instagram");
  if (type === "social" || [...kinds].some((kind) => kind !== "email" && kind !== "phone")) kinds.add("social");
  return [...kinds];
}

export function hasContactKind(contacts: { type: string; value: string }[], kinds: string[]) {
  const wanted = new Set(kinds);
  return contacts.some((item) => contactKinds(item.type, item.value).some((kind) => wanted.has(kind)));
}

export function searchSampleSize(need: number, requested: number, filtered: boolean) {
  const ask = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : need || 5, 1), 60);
  if (!filtered) return Math.min(ask, 50);
  const target = Math.max(1, Math.trunc(need) || ask);
  return Math.min(60, Math.max(ask, target * 6, 15));
}

export function nextSearchSize(current: number, have: number, need: number, saved: number) {
  if (!need || have >= need) return null;
  if (!current || saved < current) return null;
  if (current >= 60) return null;
  return Math.min(60, current * 2);
}

export function userAskedToPublish(text: string) {
  return /опублик/i.test(text);
}

export function userAskedForOffer(text: string) {
  return /кп|коммерческ|предложен/i.test(text);
}

export function userAskedToSend(text: string) {
  return /отправ/i.test(text);
}

export function siteTypeForCategory(category: string | null | undefined) {
  const text = (category || "").toLowerCase();
  if (/стомат|клиник|врач|медицин/.test(text)) return "clinic";
  if (/кафе|ресторан|кофе|бар\b|фаст|быстр|бургер|пицц|суши|шаурм|еда|столов|магазин|продукт/.test(text)) return "restaurant";
  if (/салон|красот|барбер|косметолог/.test(text)) return "beauty";
  if (/юрист|адвокат|нотариус/.test(text)) return "legal";
  if (/школ|курс|обучен|репетитор/.test(text)) return "education";
  if (/строй|ремонт/.test(text)) return "construction";
  return "services";
}
