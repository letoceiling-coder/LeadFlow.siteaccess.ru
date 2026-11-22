export type BriefFacts = {
  name: string;
  category: string | null;
  city: string | null;
  region: string | null;
  address: string | null;
  phones: string[];
  emails: string[];
  socials: string[];
  website: string | null;
  websiteStatus: string;
  rating: number | null;
  reviewCount: number | null;
  services: string[];
  features: string[];
  hours: unknown;
  description: string | null;
  sourceUrl: string | null;
};

export type BriefOptions = {
  siteType: string;
  language: string;
  style: string | null;
  pages: string[];
  wishes: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  card: "сайт-визитка",
  corporate: "корпоративный сайт",
  services: "сайт услуг",
  clinic: "сайт клиники",
  restaurant: "сайт ресторана",
  construction: "сайт строительной компании",
  beauty: "сайт салона красоты",
  legal: "сайт юридической компании",
  education: "сайт образовательной организации",
  landing: "лендинг",
  custom: "индивидуальный сайт",
};

function line(label: string, value: string | null | undefined, unknown = "неизвестно"): string {
  const text = value?.trim();
  return `- ${label}: ${text || unknown}`;
}

export function buildSiteBrief(facts: BriefFacts, options: BriefOptions): string {
  const type = TYPE_LABELS[options.siteType] ?? options.siteType;
  const services = facts.services.length ? facts.services.map((item) => `- ${item}`).join("\n") : "- в карточке не перечислены";
  const pages = options.pages.length ? options.pages.join(", ") : "Главная, Направления, Как проходит работа, Контакты";
  return [
    "Собери премиальный демонстрационный сайт. Владелец бизнеса должен захотеть такой сайт для себя: широкая коммерческая презентация, а не сухая карточка из трёх строк.",
    "Это пример предложения, не официальный сайт организации. Пометку об этом поставь коротко в подвале или у контактов. Не выноси её огромным дисклеймером на первый экран и не обесценивай подачу.",
    "",
    "Дизайн:",
    "- Собственный визуальный характер под направление: материалы, ритм, цвет и настроение профессии. Не универсальный шаблон и не пустой минималистичный каркас.",
    "- Крупная типографика, собранная композиция, контраст, воздух, аккуратные детали. Сайт должен выглядеть дорого.",
    "- Первый экран продаёт уровень: название, город, направление, сильный короткий текст и ясная кнопка позвонить или открыть контакты.",
    "- Несколько полноценных экранов на главной и отдельные страницы. Не останавливайся на шапке, адресе и телефоне.",
    "- Фотографии из Яндекс Карт и чужих сайтов не копируй. Нужные кадры создавай как оригинальные изображения или графику внутри Studio.",
    "- Не оставляй пустые строки, прочерки в графике и фразы «информация уточняется» пачками. Нет факта — нет такого блока.",
    "",
    "Содержание, которое нужно раскрыть:",
    "- Главная: первый экран, коротко о характере сервиса в этом городе, карта направлений, как начинается работа, контакты.",
    "- Направления: если в фактах услуги перечислены, опирайся на них. Если нет, покажи типовую карту услуг этого вида бизнеса и одной строкой поясни, что это демонстрационная структура направления, а не подтверждённый прайс организации.",
    "- Как проходит работа: обращение, уточнение задачи, выполнение, связь с клиентом. Без обещания сроков, гарантий и записи, которых нет в фактах.",
    "- Контакты: на странице контактов, в шапке и в подвале покажи каждый подтверждённый контакт из фактов. Телефон — кликабельная ссылка tel. Адрес — текстом. Каждую соцсеть — отдельной ссылкой на точный URL из фактов, с понятным названием (ВКонтакте, Telegram, MAX). Если сайт в карточке сам является соцсетью, покажи его как эту соцсеть, а не прячь.",
    "- Нет почты в фактах — блока почты быть не должно. Не подставляй hello@example.ru и любые другие выдуманные адреса.",
    "- Форма обращения без обещания мгновенной записи.",
    "",
    "Тексты пиши живым русским языком, плотно и конкретно под направление и город. Не канцелярит и не общие фразы «мы команда профессионалов».",
    "Запрещено выдумывать цены, скидки, лицензии, сертификаты, гарантии, годы на рынке, число клиентов, награды, имена сотрудников, тексты отзывов и юридические реквизиты.",
    "Не копируй чужой сайт. Не пиши, что сайт создан Яндексом или что организация уже является клиентом.",
    "Сделай адаптивную вёрстку и понятную навигацию.",
    "",
    `Тип: ${type}`,
    `Язык: ${options.language || "ru"}`,
    line("Стиль", options.style, "премиальный, с характером направления, дорогая типографика и собранная композиция"),
    `Страницы: ${pages}`,
    options.wishes?.trim() ? `Дополнительные пожелания: ${options.wishes.trim()}` : "Дополнительные пожелания: раскрой направление шире, чем позволяет сухая карточка, но не выдавай типовые услуги за подтверждённый прайс.",
    "",
    "Подтверждённые факты, их нельзя подменять:",
    line("Название", facts.name),
    line("Категория", facts.category),
    line("Город", facts.city),
    line("Регион", facts.region),
    line("Адрес", facts.address),
    line("Телефоны", facts.phones.join(", ") || null),
    line("Email", facts.emails.join(", ") || null),
    line("Соцсети", facts.socials.join(", ") || null),
    line("Сайт в карточке", facts.website),
    line("Классификация сайта", facts.websiteStatus),
    line("Рейтинг", facts.rating == null ? null : String(facts.rating)),
    line("Количество отзывов", facts.reviewCount == null ? null : String(facts.reviewCount)),
    line("Ссылка на карточку источника", facts.sourceUrl),
    line("Описание из источника", facts.description),
    facts.hours ? `- График из источника: ${JSON.stringify(facts.hours)}` : "- График: неизвестно, блок режима работы не показывать",
    "Услуги из источника:",
    services,
    facts.features.length ? `Особенности из источника: ${facts.features.join("; ")}` : "Особенности из источника: не указаны",
    "",
    "Рейтинг и число отзывов можно показать цифрой, только если они есть выше. Тексты отзывов не сочиняй.",
  ].join("\n");
}

export const ANALYSIS_PROMPT_VERSION = "analysis-v1";

export function buildAnalysisPrompt(facts: BriefFacts & { rawKnownKeys: string[] }): { system: string; user: string } {
  const system = [
    "Ты аналитик публичных карточек организаций. Отвечай только JSON без markdown.",
    "Не выдумывай факты. Если сведения нет во входных данных, ставь null или пиши unknown.",
    "Отделяй факты от оценок. Услуги, которых нет во входе, не добавляй.",
    "Оценка перспективности не означает готовность купить.",
    "Поля JSON: summary, activities, services, problems, opportunities, siteStructure, style, blocks, priorityFeatures, reasoning, sources, unknowns, confidence, commercialPotential.",
    "confidence — число от 0 до 1. commercialPotential — true, false или null.",
    "problems, opportunities, reasoning — массивы объектов {text, kind} где kind = fact | assumption | unknown.",
    "sources — массив {field, origin}. origin бери только из входных данных.",
  ].join(" ");
  const user = JSON.stringify({
    instruction: "Разбери только переданные поля. Не используй внешние знания об этой конкретной организации.",
    facts,
  });
  return { system, user };
}
