/** Сегменты из стратегии NEEKLO v2 (§1). A — локальный быстрый контур, B — платформенный. */
export const SEGMENTS = [
  { id: "A1", label: "Доставка еды", contour: "A", case: "Доставка, Ростов" },
  { id: "A2", label: "Автосервисы", contour: "A", case: null },
  { id: "A3", label: "Потолки, ремонт, мастера", contour: "A", case: null },
  { id: "A4", label: "Дорогой ретейл и бренды", contour: "A", case: null },
  { id: "A5", label: "Клиники и стоматологии", contour: "A", case: null },
  { id: "A6", label: "Глэмпинги и базы отдыха", contour: "A", case: "Глэмпинг" },
  { id: "B1", label: "Хобби-сообщества VK", contour: "B", case: "Моделизм" },
  { id: "B2", label: "Платные Telegram-каналы", contour: "B", case: null },
  { id: "B3", label: "Производители с дилерами", contour: "B", case: "Кабинет дилера" },
  { id: "B4", label: "Оптовики", contour: "B", case: null },
  { id: "B5", label: "Агентства и эксперты B2B", contour: "B", case: "Агентство, Астана" },
  { id: "B6", label: "Организаторы мероприятий", contour: "B", case: null },
  { id: "B7", label: "Промышленный B2B", contour: "B", case: "Система заявок" },
] as const;

export type SegmentId = (typeof SEGMENTS)[number]["id"];

export const SEGMENT_IDS = SEGMENTS.map((item) => item.id) as unknown as readonly [SegmentId, ...SegmentId[]];

export const DEFAULT_ACTIVE_SEGMENTS: SegmentId[] = ["A1", "A2", "B1"];

export function segmentInfo(id: string | null | undefined) {
  return SEGMENTS.find((item) => item.id === id) ?? null;
}

export function isSegment(value: unknown): value is SegmentId {
  return typeof value === "string" && SEGMENTS.some((item) => item.id === value);
}

const RULES: { id: SegmentId; words: string[] }[] = [
  { id: "A1", words: ["доставка еды", "суши", "роллы", "пицц", "бургер", "шаурм", "фастфуд", "столовая", "кулинар", "пекарн", "кафе", "ресторан", "доставка"] },
  { id: "A2", words: ["автосервис", "автотехцентр", "шиномонтаж", "кузовн", "автоэлектрик", "ремонт авто", "сто ", "техцентр", "детейлинг", "автомойк"] },
  { id: "A3", words: ["натяжн", "потолк", "сантехник", "муж на час", "ремонт квартир", "отделочн", "электромонтаж", "окна", "двери", "кровл", "клининг"] },
  { id: "A4", words: ["мебел", "одежд", "ювелир", "шуб", "дизайнерск", "салон штор", "кухни на заказ"] },
  { id: "A5", words: ["стоматолог", "клиник", "медицинск", "ветеринар", "ветклиник", "косметолог", "медцентр"] },
  { id: "A6", words: ["глэмпинг", "база отдыха", "турбаза", "гостевой дом", "загородный клуб", "эко-отель"] },
  { id: "B4", words: ["оптов", "стройматериал", "металлопрокат", "склад"] },
  { id: "B5", words: ["маркетинговое агентство", "рекламное агентство", "digital", "консалтинг"] },
  { id: "B6", words: ["организация мероприятий", "ивент", "ярмарк", "выставк"] },
  { id: "B7", words: ["производств", "завод", "промышленн", "оборудован"] },
];

/** Сегмент по категории из карточки. Это подсказка, AI или человек может её поменять. */
export function detectSegment(category: string | null | undefined, categories: string[] = []): SegmentId | null {
  const text = ` ${[category ?? "", ...categories].join(" ").toLowerCase().replace(/ё/g, "е")} `;
  for (const rule of RULES) {
    if (rule.words.some((word) => text.includes(word))) return rule.id;
  }
  return null;
}

/* ───────────── Пресеты брифа 27.11: сегменты А/Б/В/Г с 6 критериями гайда ───────────── */

export type PresetId = "А" | "Б" | "В" | "Г";
/** Конвертер до созвона: фрагмент 15 сек (А/Б), демо-сайт из Studio (В), демо «Радара» (Г). */
export type Converter = "fragment" | "demo" | "radar";

/** 6 критериев гайда, каждый 1–5. Стартовые оценки — по данным студии за год; Никита правит здесь. */
export type PresetCriteria = { pain: number; access: number; where: number; check: number; capacity: number; caseFit: number };

export const CRITERIA_LABELS: Record<keyof PresetCriteria, string> = {
  pain: "Боль",
  access: "Доступ к ЛПР",
  where: "Где искать",
  check: "Чек и маржа",
  capacity: "Ёмкость на 3 месяца",
  caseFit: "Есть кейс",
};

export type Preset = {
  id: PresetId;
  label: string;
  short: string;
  where: string;
  offer: string;
  /** Польза для промпта зацепки: «найди факт, связанный с [польза]». */
  benefit: string;
  converter: Converter;
  criteria: PresetCriteria;
  /** Ниши для выбора в поиске. */
  niches: string[];
  /** Слова в категории, названии или описании, по которым карточка попадает в пресет. */
  words: string[];
  /** Старые сегменты A1–B7, которые входят в этот пресет. */
  legacy: SegmentId[];
};

export const PRESETS: Preset[] = [
  {
    id: "А",
    label: "Фонды и НКО, музеи и выставки",
    short: "Фонды, музеи",
    where: "сайты, Telegram-каналы, реестры НКО",
    offer: "анимация или ИИ-видео; конвертер — фрагмент 15 сек",
    benefit: "тем, что организации нужно показать то, что нельзя снять на камеру (подопечные, история, процессы)",
    converter: "fragment",
    criteria: { pain: 4, access: 4, where: 4, check: 5, capacity: 4, caseFit: 5 },
    niches: ["благотворительный фонд", "НКО", "музей", "выставочная компания"],
    words: ["благотвор", "фонд ", "фонд ", " нко", "некоммерческ", "музе", "выставочн", "галере", "культурн", "просветит"],
    legacy: ["B6"],
  },
  {
    id: "Б",
    label: "Технологичные производители",
    short: "Производители",
    where: "сайты, Rusprofile, каналы компаний",
    offer: "реалистичные ролики о продукте; фрагмент 15 сек",
    benefit: "тем, что продукт или технологию трудно показать на фото: как устроено и как работает",
    converter: "fragment",
    criteria: { pain: 4, access: 3, where: 4, check: 5, capacity: 4, caseFit: 4 },
    niches: ["производство оборудования", "завод", "производитель", "инженерная компания"],
    words: ["производств", "производител", "завод", "промышленн", "оборудован", "инженер", "технолог", "станк"],
    legacy: ["B3", "B7"],
  },
  {
    id: "В",
    label: "Малый бизнес без сайта",
    short: "Без сайта",
    where: "Яндекс Карты, 2ГИС",
    offer: "сайт или Mini App; конвертер — демо из Studio",
    benefit: "тем, как клиенты заказывают или записываются: по телефону, в мессенджере, без сайта",
    converter: "demo",
    criteria: { pain: 4, access: 5, where: 5, check: 3, capacity: 5, caseFit: 4 },
    niches: ["доставка еды", "мебель на заказ", "детский медицинский центр", "автосервис"],
    words: ["доставка еды", "суши", "роллы", "пицц", "пекарн", "кулинар", "мебел", "кухни на заказ", "детск", "медцентр", "медицинский центр", "клиник", "автосервис", "автотехцентр", "шиномонтаж", "ремонт авто"],
    legacy: ["A1", "A2", "A4", "A5", "A3", "A6"],
  },
  {
    id: "Г",
    label: "B2B, которые ищут клиентов в Telegram",
    short: "Радар B2B",
    where: "открытые чаты",
    offer: "услуга «Радар»: запросы из открытых чатов",
    benefit: "тем, где компания ищет клиентов: чаты, объявления, запросы на аренду или подряд",
    converter: "radar",
    criteria: { pain: 4, access: 3, where: 3, check: 4, capacity: 3, caseFit: 2 },
    niches: ["складская недвижимость", "коммерческая недвижимость", "строительная компания", "ответственное хранение"],
    words: ["недвижим", "склад", "ответственное хранение", "аренда помещ", "строител", "стройк", "подрядч", "риелт", "риэлт", "брокер"],
    legacy: ["B4", "B5"],
  },
];

export function presetInfo(id: string | null | undefined): Preset | null {
  return PRESETS.find((item) => item.id === id) ?? null;
}

/** Сумма 6 критериев (6–30): в тест берём два лучших сегмента. */
export function presetScore(preset: Preset) {
  const c = preset.criteria;
  return c.pain + c.access + c.where + c.check + c.capacity + c.caseFit;
}

function norm(text: string) {
  return ` ${text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ")} `;
}

/**
 * Пресет карточки. Сначала по словам (фонд или завод узнаются по названию и описанию), потом по старому сегменту.
 * А и Б проверяются первыми: «детский фонд» — это фонд, а не детский медцентр.
 */
export function detectPreset(input: { segment?: string | null; name?: string | null; category?: string | null; categories?: string[]; description?: string | null }): PresetId | null {
  const text = norm([input.category ?? "", ...(input.categories ?? []), input.name ?? "", (input.description ?? "").slice(0, 400)].join(" "));
  const hit = (id: PresetId) => PRESETS.find((item) => item.id === id)!.words.some((word) => text.includes(word));
  // «Мебельное производство» — малый бизнес (В), а не технологичный производитель (Б).
  const order: PresetId[] = hit("А") ? ["А"] : /мебел|кухни на заказ/.test(text) ? ["В"] : ["Б", "Г", "В"];
  for (const id of order) if (hit(id)) return id;
  if (input.segment) for (const preset of PRESETS) if (preset.legacy.includes(input.segment as SegmentId)) return preset.id;
  return null;
}
