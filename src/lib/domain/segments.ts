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
