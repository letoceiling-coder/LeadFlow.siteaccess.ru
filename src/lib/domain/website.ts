export const WEBSITE_STATUSES = [
  "NO_WEBSITE",
  "WEBSITE_EXISTS",
  "SOCIAL_ONLY",
  "BROKEN_WEBSITE",
  "AGGREGATOR_ONLY",
  "UNCERTAIN",
] as const;

export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

const SOCIAL = [
  /(^|\.)vk\.com$/i,
  /(^|\.)vk\.me$/i,
  /(^|\.)max\.ru$/i,
  /(^|\.)t\.me$/i,
  /(^|\.)telegram\.me$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.com$/i,
  /(^|\.)ok\.ru$/i,
  /(^|\.)wa\.me$/i,
  /(^|\.)whatsapp\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
];

const AGGREGATORS = [
  /(^|\.)2gis\./i,
  /(^|\.)zoon\.ru$/i,
  /(^|\.)yell\.ru$/i,
  /(^|\.)flamp\.ru$/i,
  /(^|\.)prodoctorov\.ru$/i,
  /(^|\.)docdoc\.ru$/i,
  /(^|\.)avito\.ru$/i,
  /(^|\.)yandex\.(ru|com|by|kz)$/i,
  /(^|\.)google\.(com|ru)$/i,
];

export function classifyWebsite(raw: string | null | undefined): WebsiteStatus {
  const value = raw?.trim();
  if (!value) return "NO_WEBSITE";
  let hostname = "";
  let href = value;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "UNCERTAIN";
    hostname = url.hostname.replace(/^www\./i, "");
    href = url.href;
  } catch {
    return "UNCERTAIN";
  }
  if (SOCIAL.some((pattern) => pattern.test(hostname)) || /wa\.me|t\.me/i.test(href)) return "SOCIAL_ONLY";
  if (/yandex\.[^/]+\/maps/i.test(href) || /google\.[^/]+\/maps/i.test(href) || AGGREGATORS.some((pattern) => pattern.test(hostname))) {
    return "AGGREGATOR_ONLY";
  }
  return "WEBSITE_EXISTS";
}

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

export function isPublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Адрес сайта не разбирается" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Разрешены только http и https" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (PRIVATE_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Внутренние адреса проверять нельзя" };
  }
  if (host === "::1" || host === "0.0.0.0") return { ok: false, reason: "Внутренние адреса проверять нельзя" };
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return { ok: false, reason: "Некорректный IP" };
    const [a, b] = parts;
    const privateRange =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (privateRange) return { ok: false, reason: "Внутренние адреса проверять нельзя" };
  }
  return { ok: true, url };
}
