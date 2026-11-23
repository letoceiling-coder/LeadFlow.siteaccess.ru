import type { ObservationCard } from "./qualify";
import type { SegmentId } from "./segments";

/** Питч по скелету §6: крючок-факт → диагноз → оффер без давления. */

export const BANNED_PHRASES = [
  "мы делаем сайты",
  "делаем сайты",
  "сделаем сайт",
  "ai-агент",
  "ai агент",
  "ии-агент",
  "автоматизац",
  "веб-студия",
  "уникальное предложение",
  "интересный проект",
];

export function bannedIn(text: string): string[] {
  const lower = text.toLowerCase().replace(/ё/g, "е");
  return BANNED_PHRASES.filter((phrase) => lower.includes(phrase));
}

type Offer = { diagnosis: string; offer: string; caseLine: string | null };

const BY_SEGMENT: Partial<Record<SegmentId, Offer>> = {
  A1: {
    diagnosis: "Клиент листает меню, пишет, ждёт ответа — и часть заказов уходит к тем, у кого корзина в два клика.",
    offer: "Набросал, как это может выглядеть у вас: меню с ценами, корзина и оплата. Скинуть экран?",
    caseLine: "У кухни в Ростове была та же схема: поставили сайт с корзиной и оплатой — в первый же день пошли заказы без переписки.",
  },
  A2: {
    diagnosis: "Клиент звонит, попадает на занятого мастера и уезжает к конкуренту из соседнего объявления.",
    offer: "Соберу страницу записи с прайсом под ваши услуги — показать макет?",
    caseLine: null,
  },
  A3: {
    diagnosis: "Без своей страницы вы платите площадкам за каждого клиента, а сравнить вас с соседом человек не может.",
    offer: "Могу показать, как выглядела бы ваша страница с работами и заявкой — дешевле месяца рекламы. Интересно?",
    caseLine: null,
  },
  A4: {
    diagnosis: "При таком чеке покупатель хочет листать каталог и видеть цены, а не ждать ответа в личке.",
    offer: "Набросал каталог под ваш ассортимент — скинуть глянуть?",
    caseLine: null,
  },
  A5: {
    diagnosis: "Запись идёт через администратора: вечером и в выходные пациент не может записаться и выбирает другую клинику.",
    offer: "Могу показать, как работает онлайн-запись к врачу на вашем расписании. Показать?",
    caseLine: null,
  },
  A6: {
    diagnosis: "Бронь через сообщения и агрегаторы — это комиссия и потерянные гости, пока вы отвечаете.",
    offer: "У глэмпинга с той же схемой сделали прямое бронирование с оплатой. Показать, как это выглядело бы у вас?",
    caseLine: null,
  },
  B1: {
    diagnosis: "Люди продают друг другу прямо в комментариях — на этом сейчас зарабатывают площадки объявлений, а не вы.",
    offer: "Мы делали похожую площадку для моделистов: продажа, подписка, оплата. Покажу за 15 минут, как устроено?",
    caseLine: null,
  },
  B3: {
    diagnosis: "Заказы от дилеров по телефону и в таблицах — это часы менеджера каждый день и ошибки в ценах.",
    offer: "Похожим производителям делаем кабинет дилера: цены, остатки, статус заказа. Сколько часов в день уходит на заказы от дилеров?",
    caseLine: null,
  },
  B5: {
    diagnosis: "В B2B клиент до созвона хочет понимать вилку — без этого он откладывает разговор.",
    offer: "Агентству из Астаны за 3 дня собрали лендинг с калькулятором бюджета. Сделать демо-экран под ваш стиль?",
    caseLine: null,
  },
};

const FALLBACK: Offer = {
  diagnosis: "Заявки, которые приходят вручную, теряются, пока вы заняты работой.",
  offer: "Набросал, как это можно разгрузить. Скинуть глянуть?",
  caseLine: null,
};

function firstName(raw: string | null | undefined) {
  return raw?.trim() ? `${raw.trim()}, добрый день!` : "Добрый день!";
}

/** Черновик без AI — из карточки и заготовки сегмента. */
export function buildPitch(card: ObservationCard, options: { contactName?: string | null } = {}) {
  const template = (card.segment && BY_SEGMENT[card.segment]) || FALLBACK;
  const hook = card.observation ? `Увидел, что ${lowerFirst(trimDot(card.observation))}. Верно?` : null;
  const lines = [
    firstName(options.contactName),
    hook,
    template.diagnosis,
    template.caseLine,
    template.offer,
  ].filter(Boolean);
  return lines.join("\n\n");
}

function trimDot(value: string) {
  return value.trim().replace(/[.!?]+$/, "");
}

function lowerFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

/** Follow-up по стратегии: D+3, D+7, D+14, потом — «спящие». */
export const FOLLOW_UP_DAYS = [3, 7, 14] as const;

export function followUpText(step: number) {
  if (step <= 1) return "Добрый день! Поднимаю сообщение выше — посмотрели? Могу скинуть экран, займёт минуту.";
  if (step === 2) return "Здравствуйте! Набросок для вас всё ещё актуален. Если сейчас не до этого — скажите, напишу позже.";
  return "Добрый день! Последний раз напоминаю о себе. Если тема станет актуальной — просто ответьте на это сообщение.";
}

/** Когда следующий follow-up: шаг 0 — после первой отправки. null — цепочка закончилась. Не раньше чем через 2 дня после предыдущего действия. */
export function nextFollowUpAt(sentAt: Date, doneSteps: number, now: Date = sentAt): Date | null {
  const days = FOLLOW_UP_DAYS[doneSteps];
  if (days == null) return null;
  const day = 24 * 60 * 60 * 1000;
  return new Date(Math.max(sentAt.getTime() + days * day, now.getTime() + (now === sentAt ? 0 : 2 * day)));
}

export type ContactLink = { kind: "telegram" | "whatsapp" | "vk" | "email" | "phone" | "instagram" | "link"; label: string; href: string; prefill: boolean };

/** Ссылки «открыть и отправить вручную». Текст подставляется, где канал это поддерживает; иначе он в буфере. */
export function contactLinks(contacts: { kind: string; value: string }[], text: string): ContactLink[] {
  const out: ContactLink[] = [];
  const encoded = encodeURIComponent(text);
  for (const contact of contacts) {
    const value = contact.value.trim();
    if (contact.kind === "phone") {
      const digits = value.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
      if (digits.length < 10) continue;
      out.push({ kind: "whatsapp", label: `WhatsApp ${value}`, href: `https://wa.me/${digits}?text=${encoded}`, prefill: true });
      out.push({ kind: "phone", label: `Позвонить ${value}`, href: `tel:+${digits}`, prefill: false });
    } else if (contact.kind === "email") {
      out.push({ kind: "email", label: value, href: `mailto:${value}?body=${encoded}`, prefill: true });
    } else if (contact.kind === "social") {
      const lower = value.toLowerCase();
      if (/(^|\/\/|\.)t\.me\/|telegram\.me\//.test(lower)) {
        out.push({ kind: "telegram", label: `Telegram ${value.replace(/^https?:\/\//, "")}`, href: value.startsWith("http") ? value : `https://${value}`, prefill: false });
      } else if (/wa\.me\/|whatsapp/.test(lower)) {
        const digits = value.replace(/\D/g, "");
        out.push({ kind: "whatsapp", label: "WhatsApp", href: digits.length >= 10 ? `https://wa.me/${digits}?text=${encoded}` : value, prefill: digits.length >= 10 });
      } else if (/vk\.com\/|vk\.me\//.test(lower)) {
        const handle = value.replace(/^https?:\/\//, "").replace(/^(m\.)?vk\.(com|me)\//, "").split(/[/?#]/)[0];
        out.push({ kind: "vk", label: `VK ${handle}`, href: `https://vk.me/${handle}`, prefill: false });
      } else if (/(^|\/\/)(www\.)?max\.ru\//.test(lower)) {
        out.push({ kind: "link", label: "MAX", href: value.startsWith("http") ? value : `https://${value}`, prefill: false });
      } else if (/instagram\.com\//.test(lower)) {
        out.push({ kind: "instagram", label: "Instagram", href: value.startsWith("http") ? value : `https://${value}`, prefill: false });
      } else if (/^https?:\/\//.test(lower)) {
        out.push({ kind: "link", label: value.replace(/^https?:\/\//, "").slice(0, 40), href: value, prefill: false });
      }
    }
  }
  // Порядок «куда писать»: мессенджеры, где человек ответит быстрее, потом почта, звонок — последним.
  const rank: Record<ContactLink["kind"], number> = { telegram: 0, whatsapp: 1, link: 2, vk: 3, instagram: 4, email: 5, phone: 6 };
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(item.href) ? false : (seen.add(item.href), true))).sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Следующие сообщения после ответа клиента: квалифицирующий вопрос, демо, созвон (§6–§7). */
export function replyTemplates(scenario: { demo: string; product: string } | null) {
  return [
    { key: "question", label: "Уточнить", text: "Спасибо, что ответили! Подскажите, сколько заявок в день сейчас приходит и через что чаще всего — телефон, мессенджеры, соцсети?" },
    { key: "demo", label: "Показать демо", text: `Собрал короткое демо под вас${scenario ? ` — ${scenario.demo.toLowerCase()}` : ""}. Можно открыть с телефона, займёт минуту. Скинуть ссылку?` },
    { key: "call", label: "Созвон 15 мин", text: "Предлагаю созвониться на 15 минут: покажу демо на вашем примере и скажу честную вилку по цене. Когда удобно — сегодня или завтра?" },
  ];
}
