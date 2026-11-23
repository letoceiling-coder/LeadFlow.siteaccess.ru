/**
 * Задание агенту обычной фразой: «автосервисы в Ростове и Краснодаре, 50 штук».
 * Разбираем сами, без AI: города по словарю, число — сколько карточек, остальное — ниша.
 */

export const HUNT_CITIES = ["Ростов-на-Дону", "Краснодар", "Самара", "Казань", "Екатеринбург", "Воронеж", "Ставрополь", "Сочи", "Новосибирск", "Нижний Новгород", "Уфа", "Волгоград", "Пермь", "Челябинск", "Тюмень", "Москва", "Санкт-Петербург"];

export const HUNT_NICHES: { label: string; segment: string }[] = [
  { label: "Доставка еды", segment: "A1" },
  { label: "Суши", segment: "A1" },
  { label: "Пиццерия", segment: "A1" },
  { label: "Автосервис", segment: "A2" },
  { label: "Шиномонтаж", segment: "A2" },
  { label: "Детейлинг", segment: "A2" },
  { label: "Кузовной ремонт", segment: "A2" },
  { label: "Натяжные потолки", segment: "A3" },
  { label: "Ремонт квартир", segment: "A3" },
  { label: "Мебель на заказ", segment: "A4" },
  { label: "Стоматология", segment: "A5" },
  { label: "Косметология", segment: "A5" },
  { label: "База отдыха", segment: "A6" },
  { label: "Глэмпинг", segment: "A6" },
];

/** Формы названий городов в речи: «в Ростове», «по Краснодару», «спб». */
const CITY_FORMS: [RegExp, string][] = [
  [/ростов\p{L}*(?:[- ]на[- ]дону)?/iu, "Ростов-на-Дону"],
  [/краснодар\p{L}*/iu, "Краснодар"],
  [/самар\p{L}*/iu, "Самара"],
  [/казан\p{L}*/iu, "Казань"],
  [/екатеринбург\p{L}*|екб(?![\p{L}\d])/iu, "Екатеринбург"],
  [/воронеж\p{L}*/iu, "Воронеж"],
  [/ставропол\p{L}*/iu, "Ставрополь"],
  [/сочи(?![\p{L}\d])/iu, "Сочи"],
  [/новосибирск\p{L}*/iu, "Новосибирск"],
  [/нижн\p{L}* новгород\p{L}*|нижний(?![\p{L}\d])/iu, "Нижний Новгород"],
  [/уф[аеуы](?![\p{L}\d])/iu, "Уфа"],
  [/волгоград\p{L}*/iu, "Волгоград"],
  [/перм[ьи](?![\p{L}\d])/iu, "Пермь"],
  [/челябинск\p{L}*/iu, "Челябинск"],
  [/тюмен[ьи](?![\p{L}\d])/iu, "Тюмень"],
  [/москв\p{L}*|мск(?![\p{L}\d])/iu, "Москва"],
  [/санкт[- ]петербург\p{L}*|питер\p{L}*|спб(?![\p{L}\d])/iu, "Санкт-Петербург"],
];

const FILLER = /(?<![\p{L}\d])(?:найди|найти|ищи|искать|поищи|собери|мне|пожалуйста|компании|компаний|организации|организаций|штук|шт|карточек|карточки|в|во|по|и|из|городе|городах|г)(?![\p{L}\d])\.?/giu;

export function parseHuntQuery(input: string): { cities: string[]; category: string; count: number | null } {
  let rest = ` ${input.trim()} `;
  const cities: string[] = [];
  for (const [re, city] of CITY_FORMS) {
    const global = new RegExp(re.source, "giu");
    if (global.test(rest)) {
      if (!cities.includes(city)) cities.push(city);
      rest = rest.replace(new RegExp(re.source, "giu"), " ");
    }
  }
  let count: number | null = null;
  const num = rest.match(/(?<!\d)(\d{1,3})(?!\d)/);
  if (num) {
    count = Math.max(1, Math.min(500, Number(num[1])));
    rest = rest.replace(num[0], " ");
  }
  const category = rest.replace(FILLER, " ").replace(/[,.;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  const niche = HUNT_NICHES.find((item) => category.toLowerCase().startsWith(item.label.toLowerCase().slice(0, 5)));
  return { cities, category: niche && category.length <= niche.label.length + 3 ? niche.label : capitalize(category), count };
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Примерное время сбора: парсер делает паузы, чтобы Яндекс не включил капчу (~20 с на карточку). */
export function collectEtaMinutes(count: number, cities = 1) {
  return Math.max(2, Math.round((count * 20) / 60)) * Math.max(1, cities);
}
