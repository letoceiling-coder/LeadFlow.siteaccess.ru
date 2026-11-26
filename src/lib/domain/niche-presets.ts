/**
 * Пресеты ниш по сегментам брифа 27.11 (раздел 4): А — фонды, НКО, музеи; Б — технологичные производители;
 * В — малый бизнес без сайта; Г — B2B-услуги, которые ищут клиентов в Telegram (будущий «Радар»).
 * У каждой ниши — рекомендуемые источники: где такие организации реально находятся.
 * S1 может дополнять список; формат менять только добавлением полей.
 */
import type { SearchSource } from "./search-queue";

export type NicheGroupId = "А" | "Б" | "В" | "Г";

export type NicheGroup = {
  id: NicheGroupId;
  title: string;
  /** Что предлагаем и чем «конвертируем» до звонка — подсказка на экране выбора. */
  offer: string;
};

export type NichePreset = {
  /** Что ищем на картах и в Telegram: короткая фраза, как её набрал бы человек. */
  label: string;
  group: NicheGroupId;
  sources: SearchSource[];
  /** Слова для поиска Telegram-каналов, если отличаются от названия ниши. */
  telegramQuery?: string;
};

export const NICHE_GROUPS: NicheGroup[] = [
  { id: "А", title: "Фонды, НКО, музеи", offer: "анимация или ИИ-видео · фрагмент 15 сек" },
  { id: "Б", title: "Технологичные производители", offer: "ролики о продукте · фрагмент 15 сек" },
  { id: "В", title: "Малый бизнес без сайта", offer: "сайт или Mini App · демо из Studio" },
  { id: "Г", title: "B2B-услуги в Telegram", offer: "услуга «Радар»" },
];

const PRESETS: NichePreset[] = [
  // А: на картах их мало и карточки пустые — главное сайты и Telegram-каналы.
  { label: "Благотворительный фонд", group: "А", sources: ["telegram", "maps", "sites"], telegramQuery: "благотворительный фонд" },
  { label: "НКО", group: "А", sources: ["telegram", "sites"], telegramQuery: "некоммерческая организация" },
  { label: "Музей", group: "А", sources: ["maps", "sites", "telegram"] },
  { label: "Выставочная компания", group: "А", sources: ["maps", "sites", "telegram"], telegramQuery: "выставка организатор" },
  // Б: производители есть на картах, но решает сайт (что показывают о продукте) и канал компании.
  { label: "Производство оборудования", group: "Б", sources: ["maps", "sites", "telegram"] },
  { label: "Завод", group: "Б", sources: ["maps", "sites"] },
  { label: "Производство медицинской техники", group: "Б", sources: ["maps", "sites", "telegram"] },
  { label: "Производство электроники", group: "Б", sources: ["maps", "sites", "telegram"] },
  { label: "Производство стройматериалов", group: "Б", sources: ["maps", "sites"] },
  // В: малый бизнес живёт на картах; сайт открываем, чтобы понять «нет / плохой / нормальный».
  { label: "Доставка еды", group: "В", sources: ["maps", "sites"] },
  { label: "Мебель на заказ", group: "В", sources: ["maps", "sites"] },
  { label: "Детский медицинский центр", group: "В", sources: ["maps", "sites"] },
  { label: "Автосервис", group: "В", sources: ["maps", "sites"] },
  // Г: ищут клиентов в открытых чатах — нам интересны их каналы и они сами как покупатели «Радара».
  { label: "Склады в аренду", group: "Г", sources: ["telegram", "maps"], telegramQuery: "аренда склада" },
  { label: "Коммерческая недвижимость", group: "Г", sources: ["telegram", "maps"] },
  { label: "Строительная компания", group: "Г", sources: ["maps", "telegram", "sites"] },
];

/** Все пресеты ниш (копия — можно менять без последствий). */
export function nichePresets(): NichePreset[] {
  return PRESETS.map((item) => ({ ...item, sources: [...item.sources] }));
}

/** Пресеты, разложенные по сегментам в порядке А, Б, В, Г. */
export function nichePresetGroups(): (NicheGroup & { niches: NichePreset[] })[] {
  const all = nichePresets();
  return NICHE_GROUPS.map((group) => ({ ...group, niches: all.filter((item) => item.group === group.id) }));
}

function norm(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Пресет по названию ниши (без учёта регистра). Своя фраза → null, источники выбираются по умолчанию. */
export function findNichePreset(label: string): NichePreset | null {
  const key = norm(label);
  return nichePresets().find((item) => norm(item.label) === key) ?? null;
}

/** Источники по умолчанию для ниши: из пресета или «карты + сайты» для своей фразы. */
export function defaultSources(label: string): SearchSource[] {
  return findNichePreset(label)?.sources ?? ["maps", "sites"];
}
