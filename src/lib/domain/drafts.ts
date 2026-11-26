import { NOT_FOUND, wordCount } from "./dossier";
import type { PresetId } from "./segments";

/**
 * Черновики по брифу 27.11: первое сообщение в двух вариантах (A/B) до 80 слов, касания дня 4 и дня 8.
 * Структура: почему вам → что заметил → чем помогли похожим → «интересно?». Без ссылки и без просьбы о созвоне.
 * Только реальные кейсы студии (план, правило 5). Для А/Б — названия клиентов не пишем.
 */

export const MAX_WORDS = 80;
export const HOOK_PLACEHOLDER = "[зацепка: один проверяемый факт]";

export type Variant = "A" | "B";
export type Drafts = { A: string; B: string };

/** Реальные кейсы В-сегмента. Что сделано — только то, что известно из портфолио; результатов не обещаем. */
export const CASES = {
  food: { name: "Свой Хлеб", who: "пекарни «Свой Хлеб»", line: "Пекарне «Свой Хлеб» мы сделали заказ через Telegram Mini App и сайт.", example: "t.me/svoihlebekb_bot" },
  auto: { name: "Метод Малова", who: "автодиагностики «Метод Малова»", line: "Для автодиагностики «Метод Малова» мы сделали сайт.", example: "metodmalova.ru" },
  any: { name: "AZOT", who: "AZOT", line: "Для AZOT мы собрали сайт, Mini App и админку.", example: "azotrostovskiy.ru" },
} as const;

type Niche = "food" | "auto" | "furniture" | "medical" | "other";

export function nicheOf(category: string | null | undefined, segment?: string | null): Niche {
  const text = (category ?? "").toLowerCase().replace(/ё/g, "е");
  if (segment === "A1" || /доставк|еда|суши|ролл|пицц|пекарн|кулинар|кафе|ресторан|бургер/.test(text)) return "food";
  if (segment === "A2" || /авто|шиномонтаж|сто\b|детейлинг/.test(text)) return "auto";
  if (/мебел|кухни/.test(text)) return "furniture";
  if (segment === "A5" || /медцентр|медицин|клиник|педиатр|стомат|детск/.test(text)) return "medical";
  return "other";
}

const WHY: Record<Niche, string> = {
  food: "в доставке еды заказ часто теряется, пока клиент ждёт ответа в телефоне или переписке",
  auto: "в автосервис обычно записываются по телефону, и часть клиентов не дозванивается",
  furniture: "мебель на заказ выбирают долго, и людям важно видеть работы до звонка",
  medical: "в детский медцентр родители часто хотят записаться вечером, когда администратор уже не на связи",
  other: "клиенты находят вас в поиске и дальше пишут или звонят вручную",
};

function caseFor(niche: Niche) {
  return niche === "food" ? CASES.food : niche === "auto" ? CASES.auto : CASES.any;
}

function greet(name?: string | null) {
  return name?.trim() ? `Здравствуйте, ${name.trim()}.` : "Здравствуйте!";
}

function sentence(text: string) {
  const clean = text.replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "");
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : clean;
}

function lowerFirst(text: string) {
  return text && !/^[A-ZА-ЯЁ]{2}/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

export type DraftInput = {
  preset: PresetId | null;
  hook: string | null;
  topic?: string | null;
  category?: string | null;
  segment?: string | null;
  contactName?: string | null;
};

/** Собирает текст из частей; если вышло больше 80 слов — убирает необязательные части по очереди. */
function fit(parts: (string | null)[], optional: number[]): string {
  const list = [...parts];
  const join = () => list.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  for (const index of optional) {
    if (wordCount(join()) <= MAX_WORDS) break;
    list[index] = null;
  }
  let text = join();
  // Последняя страховка: длинная зацепка — режем по словам, вопрос в конце оставляем.
  if (wordCount(text) > MAX_WORDS) {
    const words = text.split(" ");
    text = `${words.slice(0, MAX_WORDS - 1).join(" ").replace(/[,.;:]+$/, "")}. Интересно?`;
  }
  return text;
}

export function buildDrafts(input: DraftInput): Drafts {
  const hasHook = Boolean(input.hook && input.hook !== NOT_FOUND);
  const hook = hasHook ? sentence(input.hook!) : HOOK_PLACEHOLDER;
  const name = greet(input.contactName);

  if (input.preset === "А" || input.preset === "Б") {
    const fund = input.preset === "А";
    const topic = input.topic?.trim() || (fund ? "свои проекты" : "свою продукцию");
    const what = fund
      ? "Мы делаем анимацию для организаций, которым нужно показать то, что нельзя снять: делали для фонда, музейного проекта и телеканала."
      : "Мы делаем реалистичные ролики о продукте, который трудно показать на фото: делали для производителя, фонда и телеканала.";
    // Вариант A — шаблон Никиты из брифа: тема → что делаем → 15 секунд → как собрать ролик.
    const a = fit([
      name,
      `Увидел: ${lowerFirst(hook)}.`,
      `Вы рассказываете про ${topic} текстом и фото.`,
      what,
      "Чтобы не описывать словами, можем сделать 15 секунд про вашу тему.",
      "Если стиль подойдёт, расскажу, как собрать из этого ролик или серию.",
    ], [2, 5]);
    // Вариант B — короче, заканчивается вопросом «интересно?» и не обещает рассказ.
    const b = fit([
      name,
      `${hook}.`,
      fund ? "Такие истории трудно снять, но их можно показать анимацией — мы делали это для фонда, музейного проекта и телеканала." : "Такое трудно показать на фото, но можно показать роликом — мы делали это для производителя, фонда и телеканала.",
      "Могу сделать 15 секунд про вашу тему, чтобы было видно, как это выглядит.",
      "Интересно?",
    ], []);
    return { A: a, B: b };
  }

  if (input.preset === "Г") {
    const a = fit([
      name,
      `Пишу, потому что ${lowerFirst(hook)}.`,
      "Мы читаем открытые Telegram-чаты по ключевым словам и отдаём компании людей, которые сами пишут «ищу склад» или «нужен подрядчик».",
      "Сейчас настраиваем такой поиск для компании из складской недвижимости.",
      "Интересно?",
    ], [3]);
    const b = fit([
      name,
      `${hook} — верно понимаю?`,
      "В открытых чатах каждый день пишут «ищу помещение» и «нужен подрядчик», и такие запросы можно получать сразу в бот.",
      "Интересно посмотреть, какие запросы были по вашей теме за последнюю неделю?",
    ], []);
    return { A: a, B: b };
  }

  // В (и всё без пресета): почему вам → что заметил → кейс → интересно?
  const niche = nicheOf(input.category, input.segment);
  const project = caseFor(niche);
  const a = fit([
    name,
    `Пишу вам, потому что ${WHY[niche]}.`,
    `Заметил: ${lowerFirst(hook)}.`,
    project.line,
    "Интересно?",
  ], [1]);
  const b = fit([
    name,
    `${hook} — верно понимаю?`,
    "Такие заказы и записи можно принимать через Mini App в Telegram или простой сайт, без переписки.",
    `Похожее делали для ${project.who}.`,
    "Показать, как это выглядело бы у вас?",
  ], [3]);
  return { A: a, B: b };
}

/** В тексте осталась заглушка — отправлять нельзя, сначала впишите факт. */
export function hasPlaceholder(text: string) {
  return /\[[^\]]{2,}\]/.test(text);
}

/* ───────────── Касания дня 4 и дня 8 ───────────── */

/** День 1 — первое сообщение, день 4 — пример или кейс, день 8 — польза без продажи. Потом пауза и статус «тишина». */
export const TOUCH_DAYS = [4, 8] as const;

export function touchKind(step: number): "day4" | "day8" | null {
  return step === 0 ? "day4" : step === 1 ? "day8" : null;
}

export function followUpDraft(step: number, preset: PresetId | null, category?: string | null, segment?: string | null): string {
  const kind = touchKind(step);
  if (kind === "day4") {
    if (preset === "А") return "Добрый день! Чтобы было понятнее, о чём речь: могу прислать пример анимации, которую делали для фонда и музейного проекта. Прислать?";
    if (preset === "Б") return "Добрый день! Чтобы было понятнее, о чём речь: могу прислать пример ролика о продукте, который делали для производителя. Прислать?";
    if (preset === "Г") return "Добрый день! Для примера могу прислать подборку запросов из открытых чатов по вашей теме за последнюю неделю — посмотрите, есть ли там ваши клиенты. Прислать?";
    const project = caseFor(nicheOf(category, segment));
    return `Добрый день! Чтобы было нагляднее, вот как это устроено у ${project.who}: ${project.example}. Похожее можно собрать под вас. Интересно?`;
  }
  if (preset === "А") return "Добрый день! Не продаю, просто мысль: если историю подопечного нельзя снимать, её можно рассказать рисованными кадрами и голосом — так сохраняется приватность. Хорошего дня!";
  if (preset === "Б") return "Добрый день! Не продаю, просто мысль: для сложного оборудования хорошо работает короткий ролик «что внутри» — разрез и движение деталей. Его удобно показывать на выставках и в КП. Хорошего дня!";
  if (preset === "Г") return "Добрый день! Не продаю, просто совет: в открытых чатах запросы быстро тонут, отвечают на них обычно в первые часы. Если ищете клиентов там, следите за словами «ищу», «нужен», «аренда». Хорошего дня!";
  return "Добрый день! Без предложения, просто совет: добавьте в карточку на картах актуальные цены и ссылку на мессенджер — по ним клиенты чаще пишут сами, а не ищут номер. Хорошего дня!";
}
