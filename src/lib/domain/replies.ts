import { z } from "zod";
import type { Converter, PresetId } from "./segments";

/**
 * Ответ клиента (бриф 27.11, сценарий 5): тип ответа, дословная цитата и следующий шаг вопросами, а не продажей.
 * Цены и сроки здесь не пишем — их называет Никита.
 */

export const REPLY_TYPES = ["interested", "price", "has_site", "not_now", "refusal"] as const;
export type ReplyType = (typeof REPLY_TYPES)[number];

export const REPLY_LABEL: Record<ReplyType, string> = {
  interested: "Интересно",
  price: "Цена",
  has_site: "Есть сайт",
  not_now: "Не сейчас",
  refusal: "Отказ",
};

export const replyAiSchema = z.object({ type: z.enum(REPLY_TYPES) });

function norm(text: string) {
  return ` ${text.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
}

const RULES: [ReplyType, RegExp][] = [
  // «Не сейчас» раньше отказа: «сейчас не интересно, напишите весной» — это пауза, а не «нет».
  ["not_now", /не сейчас|сейчас не|пока не|позже|попозже|потом напиш|напишите через|после нового года|в следующ(ем|ий|ую) (месяц|году|год|квартал|неделю)|весной|летом|осенью|зимой|не до этого|вернемся к|не в приоритете|нет времени/],
  ["refusal", /не интересн|неинтересн|не нужно|не нужен|не надо|не пишите|не беспокойте|отпишите|удалите|спам|нет спасибо|спасибо нет|нам это не|не актуальн|отказ|^ нет /],
  ["price", /сколько сто|сколько будет|стоимост| цен[аыуе] |прайс|по деньгам|бюджет|во сколько обойдет|сколько возьмете|расценк|почем/],
  ["has_site", /есть сайт|сайт есть|сайт уже|уже есть|свой сайт|у нас сайт|свой подрядчик|есть подрядчик|есть разработчик|есть дизайнер|есть свой|делает наш/],
  ["interested", /интересн|давайте|покажите|присылайте|пришлите|расскажите|подробнее|хотим|хочу|можно| да | ок |окей|актуальн|скиньте|было бы|любопытно/],
];

/** Запасное правило по ключевым словам, когда AI недоступен. Непонятный ответ считаем «интересно»: человек в диалоге. */
export function classifyReply(text: string): { type: ReplyType; matched: boolean } {
  const value = norm(text);
  for (const [type, re] of RULES) if (re.test(value)) return { type, matched: true };
  return { type: "interested", matched: false };
}

export function buildReplyPrompt(quote: string) {
  const system = [
    "Ты разбираешь ответ потенциального клиента на холодное сообщение студии (видео, анимация, сайты, Mini App).",
    "Определи один тип ответа: interested — интересно, задаёт вопросы, просит показать; price — спрашивает цену или стоимость;",
    "has_site — у них уже есть сайт, подрядчик или решение; not_now — не сейчас, позже, нет времени; refusal — отказ, не пишите.",
    "Если человек спрашивает цену — это price, даже если пишет ещё что-то. Отвечай только JSON {\"type\": \"...\"}.",
  ].join(" ");
  return { system, user: JSON.stringify({ reply: quote.slice(0, 2000) }) };
}

/** Вопросы из брифа: откуда клиенты, пробовали ли, что остановило, что изменилось бы. */
export const QUESTIONS = [
  "Откуда сейчас приходят клиенты?",
  "Пробовали уже что-то подобное?",
  "Что тогда остановило?",
  "Что изменилось бы, если бы это заработало?",
];

export type ReplyNext = {
  /** Что сделать с карточкой. */
  status: "replied" | "sleeping" | "lost";
  /** Задача-конвертер: фрагмент 15 сек (А/Б), демо-сайт (В), демо «Радара» (Г). */
  task: Converter | null;
  hint: string;
  questions: string[];
  text: string;
};

function converterOf(preset: PresetId | null): Converter {
  return preset === "А" || preset === "Б" ? "fragment" : preset === "Г" ? "radar" : "demo";
}

export const TASK_TITLE: Record<Converter, string> = {
  fragment: "Сделать фрагмент 15 сек на их тему",
  demo: "Собрать демо-сайт в Studio",
  radar: "Собрать подборку запросов «Радара» по их теме",
};

/** Следующий шаг по типу ответа. Только вопросы и мягкое предложение показать — без цен и сроков. */
export function replyNext(type: ReplyType, preset: PresetId | null): ReplyNext {
  const converter = converterOf(preset);
  const show = converter === "fragment" ? "сделаю короткий фрагмент про вашу тему" : converter === "radar" ? "соберу подборку запросов по вашей теме" : "соберу черновой вариант под вас";
  if (type === "interested") {
    return {
      status: "replied",
      task: converter,
      hint: "Не продавайте: задайте два вопроса и пообещайте показать на их примере.",
      questions: QUESTIONS.slice(0, 2),
      text: `Спасибо, что ответили! Чтобы показать на вашем примере, а не на чужом, два вопроса: откуда сейчас приходят клиенты? И пробовали уже что-то подобное? А я пока ${show}.`,
    };
  }
  if (type === "price") {
    return {
      status: "replied",
      task: converter,
      hint: "Цену называет Никита. Сначала вопросы и пример — тогда цифра будет про их задачу.",
      questions: QUESTIONS.slice(0, 3),
      text: `Честно: цена зависит от задачи, поэтому сначала пара вопросов, чтобы не гадать. Откуда сейчас приходят клиенты? Пробовали уже что-то похожее, и если да — что остановило? А я пока ${show}, чтобы было что обсуждать.`,
    };
  }
  if (type === "has_site") {
    return {
      status: "replied",
      task: null,
      hint: "Сайт есть — спросите, приносит ли он клиентов. Не спорьте.",
      questions: [QUESTIONS[0], QUESTIONS[3]],
      text: "Понял, спасибо! Подскажите, клиенты сейчас больше приходят с сайта или по звонкам и сарафану? И что изменилось бы, если бы заявок с сайта было больше?",
    };
  }
  if (type === "not_now") {
    return {
      status: "sleeping",
      task: null,
      hint: "Не дожимайте. Спросите, что должно измениться, и уходите в паузу.",
      questions: [QUESTIONS[3]],
      text: "Понял, не тороплю. Подскажите, что должно измениться, чтобы тема стала актуальной? Тогда напишу в нужный момент.",
    };
  }
  return {
    status: "lost",
    task: null,
    hint: "Поблагодарите и больше не пишите.",
    questions: [],
    text: "Спасибо, что ответили. Больше не побеспокою, хорошего дня!",
  };
}
