import { z } from "zod";
import { plural, type ObservationCard } from "./qualify";
import { scenarioOf, type Scenario } from "./scenarios";
import type { SiteScan } from "./site-scan";

/**
 * Коммерческое предложение-презентация, которое собирается сразу после ответа клиента.
 * Основа — сценарий ниши и проверенные факты карточки. AI только переписывает вступление и выводы, цифры не трогает.
 */

export type ProposalPackage = { key: "start" | "optimum" | "full"; name: string; priceRub: number; days: string; items: string[]; recommended?: boolean };

export type Proposal = {
  version: 1;
  title: string;
  business: { name: string; city: string | null; category: string | null; rating: number | null; reviewCount: number | null };
  intro: string;
  seen: string[];
  pain: string;
  product: string;
  features: string[];
  demo: string;
  calc: string | null;
  packages: ProposalPackage[];
  stages: string[];
  caseRef: string | null;
  nextStep: string;
  ai: boolean;
  createdAt: string;
};

const GENERIC: Pick<Scenario, "pain" | "product" | "features" | "priceFrom" | "priceTo" | "days" | "demo" | "caseRef" | "stages"> = {
  pain: "Заявки приходят вручную — по телефону и в мессенджерах — и часть теряется, пока вы заняты работой.",
  product: "Сайт с приёмом заявок и уведомлениями",
  features: ["Страница услуг с ценами", "Форма заявки и запись", "Уведомления о заявках в Telegram"],
  priceFrom: 30_000,
  priceTo: 60_000,
  days: [5, 10],
  demo: "Демо-экран с вашими услугами",
  caseRef: null,
  stages: ["Бриф и доступы", "Демо-экран согласован", "Предоплата 50%", "Сборка и контент", "Запуск и проверка заявок", "Финальная оплата"],
};

function round(value: number) {
  return Math.round(value / 5000) * 5000;
}

export function packagesFor(scenario: Pick<Scenario, "features" | "priceFrom" | "priceTo" | "days">): ProposalPackage[] {
  const [minDays, maxDays] = scenario.days;
  const mid = round((scenario.priceFrom + scenario.priceTo) / 2);
  return [
    { key: "start", name: "Старт", priceRub: scenario.priceFrom, days: `${minDays}–${Math.max(minDays + 2, Math.round((minDays + maxDays) / 2))} дней`, items: [...scenario.features.slice(0, 2), "Адаптив под телефон", "Подключение домена и заявок в Telegram"] },
    { key: "optimum", name: "Оптимум", priceRub: mid, days: `${Math.round((minDays + maxDays) / 2)}–${maxDays} дней`, recommended: true, items: [...scenario.features, "Тексты и фото из ваших соцсетей", "Аналитика заявок", "Месяц поддержки"] },
    { key: "full", name: "Под ключ", priceRub: round(scenario.priceTo * 1.3), days: `${maxDays}–${maxDays + 7} дней`, items: [...scenario.features, "Интеграция с CRM или 1С", "Бот-уведомления клиентам", "Настройка рекламы на старт", "3 месяца поддержки"] },
  ];
}

export function buildProposal(input: {
  name: string;
  city: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  card: ObservationCard | null;
  site: SiteScan | null;
  now?: Date;
}): Proposal {
  const scenario = scenarioOf(input.card?.segment) ?? null;
  const base = scenario ?? GENERIC;
  const seen = [
    ...(input.card?.chaos ?? []).map((item) => item.text),
    ...(input.card?.money ?? []).map((item) => item.text),
  ].filter((text, index, list) => list.indexOf(text) === index).slice(0, 5);
  const product = scenario?.product ?? GENERIC.product;
  const reviews = input.reviewCount && input.reviewCount >= 20 ? ` У вас ${input.reviewCount} ${plural(input.reviewCount, "отзыв", "отзыва", "отзывов")}${input.rating ? ` и рейтинг ${input.rating.toFixed(1)}` : ""} — клиенты вас уже выбирают, осталось не терять их на этапе заявки.` : "";
  return {
    version: 1,
    title: `${product} для «${input.name}»`,
    business: { name: input.name, city: input.city, category: input.category, rating: input.rating, reviewCount: input.reviewCount },
    intro: `Посмотрели, как сейчас устроены заявки у «${input.name}»${input.city ? ` (${input.city})` : ""}, и собрали предложение под вашу нишу.${reviews}`,
    seen,
    pain: base.pain,
    product,
    features: base.features,
    demo: base.demo,
    calc: input.card?.calc?.text ?? null,
    packages: packagesFor(base),
    stages: base.stages,
    caseRef: input.card?.caseRef ?? base.caseRef ?? null,
    nextStep: "Покажем демо-экран на ваших услугах за 15 минут созвона. Вы ничего не платите до согласования демо.",
    ai: false,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Что AI может переписать. Цены, пакеты и факты — только из данных. */
export const proposalAiSchema = z.object({
  intro: z.string().trim().min(40).max(600),
  pain: z.string().trim().min(20).max(400),
  nextStep: z.string().trim().min(20).max(300),
});

export function proposalPrompt(proposal: Proposal) {
  const system = [
    "Ты пишешь вступление коммерческого предложения от студии цифровых продуктов малому бизнесу. Отвечай только JSON: {intro, pain, nextStep}.",
    "Тон: на «вы», по-человечески, без канцелярита и без слов «уникальный», «инновационный», «под ключ», «автоматизация».",
    "Опирайся только на переданные факты. Не придумывай цифры, отзывы, кейсы и сроки.",
    "intro — 2–3 предложения: что мы увидели у этого бизнеса и зачем ему это решение. pain — одна боль клиента их клиента. nextStep — один конкретный следующий шаг (демо или созвон 15 минут).",
  ].join(" ");
  const user = JSON.stringify({ business: proposal.business, seen: proposal.seen, product: proposal.product, features: proposal.features, demo: proposal.demo, calc: proposal.calc });
  return { system, user };
}

export function proposalText(proposal: Proposal, url: string) {
  const best = proposal.packages[0];
  return [
    "Собрал для вас короткое предложение — с тем, что увидел у вас, вариантами и сроками:",
    url,
    `Если коротко: ${proposal.product.toLowerCase()}, от ${best.priceRub.toLocaleString("ru-RU")} ₽, ${best.days}.`,
    proposal.nextStep,
  ].join("\n\n");
}

/** Превью ссылок в мессенджерах и поисковые роботы — не «клиент открыл». */
export function isPreviewBot(userAgent: string | null | undefined) {
  if (!userAgent) return true;
  return /bot|crawler|spider|preview|TelegramBot|WhatsApp|vkShare|facebookexternalhit|Slackbot|Discordbot|Twitterbot|SkypeUriPreview|curl|wget|python|node-fetch|HeadlessChrome/i.test(userAgent);
}
