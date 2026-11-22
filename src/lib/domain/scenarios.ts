import type { SegmentId } from "./segments";

/**
 * Сценарии по нишам из стратегии NEEKLO v2 (§1 сегменты, §6 питчи, §7 демо, §11 тарифы).
 * Сценарий — это готовая «упаковка» сделки: что болит, что продаём, сколько стоит, из чего состоит проект.
 */

export type Scenario = {
  id: SegmentId;
  title: string;
  contour: "A" | "B";
  pain: string;
  product: string;
  features: string[];
  priceFrom: number;
  priceTo: number;
  days: [number, number];
  demo: string;
  caseRef: string | null;
  /** Этапы проекта: превращаются в чек-лист карточки проекта. */
  stages: string[];
  tone: "yellow" | "orange" | "pink" | "blue" | "green" | "violet";
};

const LOCAL_STAGES = ["Бриф и доступы", "Демо-экран согласован", "Предоплата 50%", "Сборка и контент", "Запуск и проверка заявок", "Финальная оплата"];
const PLATFORM_STAGES = ["Разбор процесса (аудит)", "Смета с 2–3 вариантами", "Договор и аванс", "Прототип ключевого экрана", "Разработка MVP", "Пилот на 5–10 пользователях", "Запуск и поддержка"];

export const SCENARIOS: Scenario[] = [
  {
    id: "A1", title: "Доставка еды", contour: "A", tone: "yellow",
    pain: "Заказы в WhatsApp и по телефону, меню картинкой в сторис — часть клиентов уходит, не дождавшись ответа.",
    product: "Сайт доставки с корзиной и оплатой",
    features: ["Меню с ценами и фото", "Корзина и онлайн-оплата", "Заказ без переписки, уведомление в Telegram"],
    priceFrom: 50_000, priceTo: 70_000, days: [7, 14],
    demo: "Живое меню с корзиной на их блюдах и фото из соцсетей",
    caseRef: "Доставка, Ростов", stages: LOCAL_STAGES,
  },
  {
    id: "A2", title: "Автосервисы", contour: "A", tone: "orange",
    pain: "Запись только звонком, прайса нет — клиент попадает на занятого мастера и уезжает к соседу.",
    product: "Сайт с онлайн-записью и прайсом",
    features: ["Прайс по услугам", "Онлайн-запись на слот", "Напоминание клиенту о визите"],
    priceFrom: 30_000, priceTo: 50_000, days: [3, 7],
    demo: "Страница записи с их услугами и ценами",
    caseRef: null, stages: LOCAL_STAGES,
  },
  {
    id: "A3", title: "Потолки, ремонт, мастера", contour: "A", tone: "pink",
    pain: "Живут на Авито и Директе, платят за каждого клиента, своей страницы нет.",
    product: "Сайт-визитка с работами и заявкой",
    features: ["Портфолио работ", "Калькулятор стоимости", "Форма заявки"],
    priceFrom: 30_000, priceTo: 50_000, days: [3, 7],
    demo: "Визитка с их работами и калькулятором",
    caseRef: null, stages: LOCAL_STAGES,
  },
  {
    id: "A4", title: "Дорогой ретейл", contour: "A", tone: "violet",
    pain: "Каталог постами в Telegram и прайс в Word — дорогой товар продают как с рынка.",
    product: "Каталог-сайт или Mini App",
    features: ["Каталог с фильтрами", "Карточки товара с ценой", "Заявка в один клик"],
    priceFrom: 50_000, priceTo: 70_000, days: [7, 14],
    demo: "Каталог на 10–20 их позициях",
    caseRef: null, stages: LOCAL_STAGES,
  },
  {
    id: "A5", title: "Клиники и стоматологии", contour: "A", tone: "blue",
    pain: "Запись через администратора: вечером и в выходные пациент уходит в другую клинику.",
    product: "Сайт с онлайн-записью и ботом",
    features: ["Врачи и услуги", "Онлайн-запись по расписанию", "Бот-напоминание"],
    priceFrom: 50_000, priceTo: 90_000, days: [10, 14],
    demo: "Запись к врачу на их расписании",
    caseRef: null, stages: LOCAL_STAGES,
  },
  {
    id: "A6", title: "Глэмпинги и базы", contour: "A", tone: "green",
    pain: "Бронь в директ и через агрегаторы — комиссия и потерянные гости.",
    product: "Прямое бронирование с оплатой",
    features: ["Домики и даты", "Онлайн-бронь и предоплата", "Синхронизация занятости"],
    priceFrom: 50_000, priceTo: 90_000, days: [10, 14],
    demo: "Бронь их домиков с календарём",
    caseRef: "Глэмпинг", stages: LOCAL_STAGES,
  },
  {
    id: "B1", title: "Хобби-сообщества VK", contour: "B", tone: "yellow",
    pain: "Барахолка в комментариях — на сделках зарабатывает Авито, а не сообщество.",
    product: "Комьюнити-площадка с оплатой и подпиской",
    features: ["Объявления участников", "Подписка и платный доступ", "Безопасная сделка"],
    priceFrom: 250_000, priceTo: 450_000, days: [42, 56],
    demo: "Один экран ленты объявлений с подпиской",
    caseRef: "Моделизм", stages: PLATFORM_STAGES,
  },
  {
    id: "B2", title: "Платные Telegram-каналы", contour: "B", tone: "blue",
    pain: "Доступ выдаётся вручную в личке — автор тратит часы и теряет оплаты.",
    product: "Кабинет с оплатой и автодоступом",
    features: ["Оплата подписки", "Автоматический доступ в канал", "Продления и напоминания"],
    priceFrom: 250_000, priceTo: 450_000, days: [42, 56],
    demo: "Страница оплаты с выдачей доступа",
    caseRef: null, stages: PLATFORM_STAGES,
  },
  {
    id: "B3", title: "Производители с дилерами", contour: "B", tone: "orange",
    pain: "Заказы дилеров по телефону и в Excel, прайсы в PDF — часы менеджера и ошибки в ценах.",
    product: "Кабинет дилера",
    features: ["Персональные цены", "Остатки и заказ", "Статусы заказов"],
    priceFrom: 350_000, priceTo: 700_000, days: [56, 98],
    demo: "Мини-кабинет: прайс, корзина, статус",
    caseRef: "Кабинет дилера", stages: PLATFORM_STAGES,
  },
  {
    id: "B4", title: "Оптовики", contour: "B", tone: "green",
    pain: "50+ объявлений, заявки вручную, B2B-каталога нет.",
    product: "B2B-каталог с заявкой менеджеру",
    features: ["Каталог с оптовыми ценами", "Заявка на объём", "Выгрузка в 1С/таблицу"],
    priceFrom: 350_000, priceTo: 700_000, days: [56, 98],
    demo: "Каталог на их позициях с оптовой заявкой",
    caseRef: null, stages: PLATFORM_STAGES,
  },
  {
    id: "B5", title: "Агентства и эксперты B2B", contour: "B", tone: "violet",
    pain: "Презентация ссылкой в WhatsApp — клиент до созвона не понимает вилку и откладывает.",
    product: "Лендинг с калькулятором и конструктором услуг",
    features: ["Калькулятор бюджета", "Конструктор услуг", "Кейсы и заявка"],
    priceFrom: 50_000, priceTo: 150_000, days: [3, 14],
    demo: "Калькулятор бюджета в их стиле",
    caseRef: "Агентство, Астана", stages: LOCAL_STAGES,
  },
  {
    id: "B6", title: "Организаторы мероприятий", contour: "B", tone: "pink",
    pain: "Регистрация через Google Forms, билеты и списки вручную.",
    product: "Платформа регистрации и билетов",
    features: ["Регистрация и билеты", "Кабинет участника", "Списки и чек-ин"],
    priceFrom: 250_000, priceTo: 450_000, days: [42, 56],
    demo: "Страница события с регистрацией",
    caseRef: null, stages: PLATFORM_STAGES,
  },
  {
    id: "B7", title: "Промышленный B2B", contour: "B", tone: "blue",
    pain: "Заказы в почте, согласования вручную, повторные заказы теряются.",
    product: "Внутренняя система заявок",
    features: ["Заявки и согласования", "История заказов клиента", "Отчёты"],
    priceFrom: 350_000, priceTo: 700_000, days: [56, 98],
    demo: "Экран заявки с согласованием",
    caseRef: "Система заявок", stages: PLATFORM_STAGES,
  },
];

export function scenarioOf(id: string | null | undefined): Scenario | null {
  return SCENARIOS.find((item) => item.id === id) ?? null;
}

export function checklistFrom(scenario: Scenario | null) {
  const stages = scenario?.stages ?? LOCAL_STAGES;
  return stages.map((title, index) => ({ id: `s${index + 1}`, title, done: false }));
}

export const PROJECT_STAGES = [
  { key: "brief", label: "Бриф" },
  { key: "estimate", label: "Смета" },
  { key: "prepaid", label: "Аванс" },
  { key: "in_work", label: "В работе" },
  { key: "review", label: "Сдача" },
  { key: "done", label: "Готово" },
  { key: "cancelled", label: "Отменён" },
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number]["key"];

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === "string" && PROJECT_STAGES.some((item) => item.key === value);
}
