import { describe, expect, it } from "vitest";
import {
  buildRadarPrompt,
  finalScore,
  keywordFilter,
  parseCallback,
  callbackData,
  parseChatRef,
  parseRadarJson,
  parseWordList,
  readablePeer,
  rejectPenalty,
  stem,
} from "../src/lib/domain/radar";

describe("радар: морфология и фильтр по словам", () => {
  it("сводит формы к одной основе", () => {
    expect(stem("склада")).toBe(stem("склад"));
    expect(stem("складов")).toBe(stem("склад"));
    expect(stem("аренду")).toBe(stem("аренда"));
    expect(stem("арендую")).toBe(stem("аренда"));
    expect(stem("хранения")).toBe(stem("хранение"));
    expect(stem("ищу")).toBe(stem("ищем"));
    expect(stem("нужна")).toBe(stem("нужен"));
  });

  it("фраза совпадает в любой форме и порядке слов", () => {
    const text = "Добрый день! Ищем склад в аренду от 500 м2, Подольск, заезд в декабре";
    const verdict = keywordFilter(text, ["аренда склада", "ответственное хранение"]);
    expect(verdict.pass).toBe(true);
    expect(verdict.matched).toEqual(["аренда склада"]);
  });

  it("однокоренное прилагательное тоже ловится («складское помещение»)", () => {
    expect(keywordFilter("Нужно складское помещение под производство", ["склад"]).pass).toBe(true);
    expect(keywordFilter("Нужны помещения под производство", ["помещение под производство"]).pass).toBe(true);
  });

  it("минус-слово отсекает сообщение", () => {
    const verdict = keywordFilter("Сдам склад 300 м2 в аренду, без комиссии", ["аренда склада"], ["сдам", "без комиссии"]);
    expect(verdict.pass).toBe(false);
    expect(verdict.blockedBy).toBe("сдам");
  });

  it("без совпадений не пропускает", () => {
    expect(keywordFilter("Продам гараж в Химках", ["аренда склада"]).pass).toBe(false);
  });

  it("список слов из строки: запятые и строки, без повторов", () => {
    expect(parseWordList("аренда склада, ищу склад\nИщу склад;  ответственное   хранение ")).toEqual(["аренда склада", "ищу склад", "ответственное хранение"]);
  });
});

describe("радар: разбор JSON модели", () => {
  it("английские ключи, null вместо выдумок, балл ограничен 0–100", () => {
    const result = parseRadarJson('```json\n{"intent":"request","city":"Подольск","district":"не указан","deadline":null,"budget":"","score":140,"summary":"Ищет склад 500 м2","reply":"Здравствуйте! Какая площадь нужна?"}\n```');
    expect(result).toEqual({ intent: "request", city: "Подольск", district: null, deadline: null, budget: null, score: 100, summary: "Ищет склад 500 м2", reply: "Здравствуйте! Какая площадь нужна?" });
  });

  it("русские ключи и текст вокруг JSON", () => {
    const result = parseRadarJson('Вот ответ: {"намерение":"предлагает","город":null,"район":null,"срок":"до 1 декабря","бюджет":"NOT_FOUND","балл":"15","суть":"Сдаёт склад","подсказка_ответа":null}');
    expect(result.intent).toBe("offer");
    expect(result.deadline).toBe("до 1 декабря");
    expect(result.budget).toBeNull();
    expect(result.score).toBe(15);
  });

  it("неизвестное намерение → other, мусор → ошибка", () => {
    expect(parseRadarJson('{"intent":"что-то","score":null}').intent).toBe("other");
    expect(parseRadarJson('{"intent":"что-то","score":null}').score).toBe(0);
    expect(() => parseRadarJson("не знаю")).toThrow();
  });
});

describe("радар: «Не то» понижает похожие", () => {
  const rejected = ["Сдам склад 500 м2 в Подольске, отапливаемый, пандус"];

  it("похожее сообщение получает штраф, непохожее — нет", () => {
    const similar = rejectPenalty("Сдам отапливаемый склад 300 м2 в Подольске с пандусом", rejected);
    const other = rejectPenalty("Ищем помещение под производство мебели в Люберцах", rejected);
    expect(similar).toBeGreaterThanOrEqual(30);
    expect(other).toBe(0);
    expect(finalScore(70, similar)).toBeLessThan(40);
    expect(finalScore(70, other)).toBe(70);
  });

  it("примеры «Не то» попадают в промпт", () => {
    const prompt = buildRadarPrompt({ projectName: "Брокер складов", kind: "client", target: "ищут склад", keywords: ["склад"], chatTitle: "Склады МО", text: "Ищу склад", rejected });
    expect(prompt.user).toContain("Не то");
    expect(prompt.user).toContain("Сдам склад 500 м2");
    expect(prompt.system).toContain("строго JSON");
  });
});

describe("радар: ссылки на чаты и кнопки бота", () => {
  it("принимает @username и t.me, отклоняет приглашения в закрытые", () => {
    expect(parseChatRef("@sklad_msk")).toBe("sklad_msk");
    expect(parseChatRef("https://t.me/sklad_msk/123")).toBe("sklad_msk");
    expect(parseChatRef("t.me/s/sklad_msk")).toBe("sklad_msk");
    expect(parseChatRef("https://t.me/+AbCdEf123")).toBeNull();
    expect(parseChatRef("https://t.me/joinchat/AbCdEf")).toBeNull();
    expect(parseChatRef("ab")).toBeNull();
  });

  it("читаем только открытые группы и каналы", () => {
    expect(readablePeer({ type: "supergroup", username: "sklad" })).toBe(true);
    expect(readablePeer({ type: "user", username: "ivan" })).toBe(false);
    expect(readablePeer({ type: "group", username: null })).toBe(false);
  });

  it("callback_data туда и обратно", () => {
    const data = callbackData("reject", "clx1234567890abcdefghijkl");
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseCallback(data)).toEqual({ action: "reject", findingId: "clx1234567890abcdefghijkl" });
    expect(parseCallback("x:y")).toBeNull();
  });
});
