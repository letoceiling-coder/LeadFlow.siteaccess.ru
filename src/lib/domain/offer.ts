import { createHmac, timingSafeEqual } from "crypto";
import { buildOfferLetter, offerPlainText, type OfferFormat, type SiteFact } from "./offer-content";
import { renderOfferHtml } from "./offer-html";

export const OPT_OUT_STOP = "Клиент нажал «Не беспокоить». Повторно не пишем ни по одному каналу.";
export const OFFER_TEMPLATE_NAME = "Коммерческое предложение";

export const OFFER_SERVICES: { title: string; items: string[] }[] = [
  {
    title: "Продвижение и реклама",
    items: [
      "Продвижение сайта и карточки организации",
      "Реклама в интернете",
      "Видеореклама",
      "Раскрутка социальных сетей",
      "Поиск потенциальных клиентов",
    ],
  },
  {
    title: "Разработка",
    items: [
      "Сайты и лендинги",
      "Интернет-магазины",
      "Мобильные приложения",
      "Боты для Telegram, MAX и других мессенджеров",
      "Ассистенты и автоматические ответы клиентам",
      "Интеграции с почтой, CRM, оплатой и учётом заявок",
    ],
  },
  {
    title: "Сопровождение",
    items: [
      "Доработка и поддержка уже запущенных решений",
      "Аналитика обращений и заявок",
      "Оформление контента и публикаций",
    ],
  },
];

export type ReplyContacts = {
  phone: string;
  telegram: string;
  max: string;
  email: string;
};

export type OfferReply = {
  phone: { display: string; href: string } | null;
  telegram: string | null;
  max: string | null;
  email: string | null;
};

export function formatPhone(value: string): { display: string; href: string } | null {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
  if (national.length === 11 && national.startsWith("7")) {
    return {
      display: `+7 ${national.slice(1, 4)} ${national.slice(4, 7)}-${national.slice(7, 9)}-${national.slice(9, 11)}`,
      href: `tel:+${national}`,
    };
  }
  if (national.length < 10 || national.length > 15) return null;
  return { display: `+${national}`, href: `tel:+${national}` };
}

export function telegramLink(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const url = text.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]{4,32})\/?$/i);
  if (url) return `https://t.me/${url[1]}`;
  const handle = text.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{4,32}$/.test(handle)) return null;
  return `https://t.me/${handle}`;
}

export function maxLink(value: string): string | null {
  const text = value.trim();
  if (!/^https:\/\/max\.ru\/\S+$/i.test(text)) return null;
  return text;
}

export function replyProblems(reply: ReplyContacts): string | null {
  if (reply.phone && !formatPhone(reply.phone)) return "Телефон для обратной связи указан не полностью";
  if (reply.telegram && !telegramLink(reply.telegram)) return "Ссылка Telegram должна быть @именем или адресом t.me";
  if (reply.max && !maxLink(reply.max)) return "Ссылка MAX должна начинаться с https://max.ru/";
  if (reply.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply.email)) return "Почта для обратной связи указана неверно";
  return null;
}

export type OptOutPayload = { tenantId: string; organizationId: string; messageId: string };

export function signOptOut(payload: OptOutPayload, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readOptOut(token: string, secret: string): OptOutPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || token.split(".").length !== 2) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OptOutPayload>;
    if (!parsed.tenantId || !parsed.organizationId || !parsed.messageId) return null;
    return { tenantId: parsed.tenantId, organizationId: parsed.organizationId, messageId: parsed.messageId };
  } catch {
    return null;
  }
}

export function offerTemplateBody() {
  const services = OFFER_SERVICES.flatMap((group) => [group.title, ...group.items.map((item) => `- ${item}`), ""]);
  return [
    "Здравствуйте.",
    "",
    "Индивидуально для «{{name}}» ({{category}}, {{city}}).",
    "Демонстрационный сайт: {{site}}",
    "Это пример, не официальный сайт организации. Цены и сроки не указаны.",
    "",
    "Дополнительно можем сделать:",
    ...services,
    "Ответить:",
    "Телефон: {{phone}}",
    "Почта: {{email}}",
    "Telegram: {{telegram}}",
    "MAX: {{max}}",
    "",
    "Если вы не хотите получать от нас предложения, вы можете отказаться от дальнейших сообщений.",
    "Отписаться от рассылки: {{opt_out}}",
  ].join("\n");
}

export function buildCommercialOffer(input: {
  name: string;
  city: string | null;
  category: string | null;
  siteUrl: string;
  optOutUrl: string;
  reply: OfferReply;
  format?: OfferFormat;
  siteFact?: SiteFact;
  hasSocial?: boolean;
  desktopShot?: string | null;
  mobileShot?: string | null;
}): { subject: string; preheader: string; text: string; html: string } | { error: string } {
  const siteUrl = input.siteUrl.trim();
  const optOutUrl = input.optOutUrl.trim();
  if (!/^https:\/\/\S+$/i.test(siteUrl)) return { error: "У сайта нет публичной ссылки, предложение не собрано." };
  if (!/^https:\/\/\S+$/i.test(optOutUrl)) return { error: "Нет ссылки для отказа от рассылки, предложение не собрано." };
  const lines = [
    input.reply.phone ? `Телефон: ${input.reply.phone.display}` : "",
    input.reply.email ? `Почта: ${input.reply.email}` : "",
    input.reply.telegram ? `Telegram: ${input.reply.telegram}` : "",
    input.reply.max ? `MAX: ${input.reply.max}` : "",
  ].filter(Boolean);
  if (!lines.length) return { error: "Контакты для обратной связи не заданы. Укажите их в настройках." };
  const letter = buildOfferLetter({
    name: input.name,
    city: input.city,
    category: input.category,
    format: input.format,
    siteFact: input.siteFact,
    hasSocial: input.hasSocial,
  });
  const text = offerPlainText(letter, { siteUrl, optOutUrl, lines });
  const html = renderOfferHtml({
    letter,
    name: input.name,
    siteUrl,
    optOutUrl,
    desktopShot: input.desktopShot,
    mobileShot: input.mobileShot,
    reply: input.reply,
  });
  return { subject: letter.subject, preheader: letter.preheader, text, html };
}
