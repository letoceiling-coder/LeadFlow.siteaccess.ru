import { describe, expect, it } from "vitest";
import { classifyReply, replyNext, REPLY_TYPES } from "../src/lib/domain/replies";
import { NOT_FOUND, chatTargets, channelsOf, checkHook, gradeOf, hookFromPost, postFacts, siteVerdict, wordCount } from "../src/lib/domain/dossier";
import { MAX_WORDS, buildDrafts, followUpDraft, hasPlaceholder, touchKind } from "../src/lib/domain/drafts";
import { changeForTomorrow, decision50, funnelRows, type FunnelRecord } from "../src/lib/domain/funnel";
import { PRESETS, detectPreset, presetScore } from "../src/lib/domain/segments";
import { bannedIn } from "../src/lib/domain/pitch";

describe("классификатор ответов", () => {
  const cases: [string, string][] = [
    ["сколько стоит?", "price"],
    ["А по цене сколько будет?", "price"],
    ["Какая стоимость ролика", "price"],
    ["Интересно, покажите", "interested"],
    ["Да, давайте", "interested"],
    ["У нас уже есть сайт", "has_site"],
    ["Сайт есть, спасибо", "has_site"],
    ["Не сейчас, напишите после нового года", "not_now"],
    ["сейчас не до этого", "not_now"],
    ["Не интересно", "refusal"],
    ["Нет", "refusal"],
    ["Не пишите сюда больше", "refusal"],
  ];
  for (const [text, type] of cases) it(`«${text}» → ${type}`, () => expect(classifyReply(text).type).toBe(type));

  it("непонятный ответ — человек в диалоге, считаем «интересно», но без совпадения", () => {
    expect(classifyReply("А вы кто?")).toEqual({ type: "interested", matched: false });
  });

  it("«цена» и «интересно» ставят задачу: фрагмент для А/Б, демо для В", () => {
    expect(replyNext("price", "А").task).toBe("fragment");
    expect(replyNext("interested", "Б").task).toBe("fragment");
    expect(replyNext("price", "В").task).toBe("demo");
    expect(replyNext("not_now", "В").task).toBeNull();
    expect(replyNext("refusal", "А").status).toBe("lost");
    expect(replyNext("not_now", "А").status).toBe("sleeping");
  });

  it("подсказки — вопросы без цен и сроков", () => {
    for (const type of REPLY_TYPES) {
      for (const preset of ["А", "Б", "В", "Г", null] as const) {
        const next = replyNext(type, preset);
        expect(next.text).not.toMatch(/₽|руб|тыс|\d+\s*(дн|час|недел)|срок|завтра|сегодня/i);
        if (type !== "refusal") expect(next.text).toContain("?");
      }
    }
  });
});

describe("оценка A/B/C по правилу гайда", () => {
  it("A — зацепка, прямой канал, сайта нет", () => {
    expect(gradeOf({ hook: "Открыли вторую точку на Ленина и принимаете заказы только по телефону", direct: true, site: "none", preset: "В" }).grade).toBe("A");
  });
  it("нормальный сайт у малого бизнеса — не A", () => {
    expect(gradeOf({ hook: "Открыли вторую точку", direct: true, site: "ok", preset: "В" }).grade).toBe("B");
  });
  it("для фондов и производителей сайт не важен — A при зацепке и прямом канале", () => {
    expect(gradeOf({ hook: "Фонд собирает на реабилитацию", direct: true, site: "ok", preset: "А" }).grade).toBe("A");
  });
  it("NOT_FOUND без прямого канала — C", () => {
    expect(gradeOf({ hook: NOT_FOUND, direct: false, site: "none", preset: "В" }).grade).toBe("C");
  });
  it("федеральная сеть — всегда C", () => {
    expect(gradeOf({ hook: "Факт", direct: true, site: "none", preset: "В", blocked: true }).grade).toBe("C");
  });
  it("зацепка от AI: выдуманные числа и «нет сайта» при сайте отбрасываются", () => {
    const source = "пекарня открыла вторую точку на улице ленина, заказы принимают по телефону";
    expect(checkHook("Пекарня открыла вторую точку на улице Ленина и заказы принимает только по телефону", source, false)).not.toBeNull();
    expect(checkHook("Пекарня за 12 лет открыла 5 точек и принимает заказы только по телефону", source, false)).toBeNull();
    expect(checkHook("У пекарни нет своего сайта, заказы принимают только по телефону вручную", source, true)).toBeNull();
    expect(checkHook("NOT_FOUND", source, false)).toBeNull();
    expect(checkHook("Коротко", source, false)).toBeNull();
  });
  it("сайт: нет, слабый (конструктор), нормальный", () => {
    expect(siteVerdict({ websiteStatus: "NO_WEBSITE", website: null, site: null }).verdict).toBe("none");
    expect(siteVerdict({ websiteStatus: "WEBSITE_EXISTS", website: "https://x.tilda.ws", site: null }).verdict).toBe("weak");
    expect(siteVerdict({ websiteStatus: "WEBSITE_EXISTS", website: "https://x.ru", site: null }).verdict).toBe("ok");
  });
});

describe("досье: каналы и посты", () => {
  const raw = { telegram: { username: "fondhelp", title: "Фонд", members: 900, posts: [
    { id: 1, date: "2026-11-20T10:00:00Z", text: "Старый пост про сбор на коляску для Миши", link: "https://t.me/fondhelp/1" },
    { id: 2, date: "2026-11-25T10:00:00Z", text: "Открыли сбор на реабилитацию Ани после операции", link: "https://t.me/fondhelp/2" },
  ] } };
  it("посты из raw.telegram — свежие сверху", () => {
    const posts = postFacts(raw);
    expect(posts[0].link).toBe("https://t.me/fondhelp/2");
    expect(hookFromPost(posts)).toContain("25.11");
  });
  it("канал организации — не прямой канал, личный @ и мобильный — прямой", () => {
    const channels = channelsOf([{ type: "telegram", value: "@fondhelp" }, { type: "telegram", value: "@anna_director" }, { type: "phone", value: "+7 (912) 000-11-22" }, { type: "phone", value: "+7 (343) 200-00-00" }, { type: "email", value: "a@b.ru" }], raw);
    expect(channels.find((item) => item.value === "fondhelp")?.direct).toBe(false);
    expect(channels.find((item) => item.value === "anna_director")?.direct).toBe(true);
    expect(channels.filter((item) => item.kind === "phone").map((item) => item.direct)).toEqual([true, false]);
    const targets = chatTargets(channels);
    expect(targets[0].href).toBe("https://t.me/anna_director");
    expect(targets.some((item) => item.href === "https://t.me/+79120001122")).toBe(true);
    expect(targets.some((item) => item.channel === "max" && item.href === null)).toBe(true);
  });
});

describe("черновики первого сообщения", () => {
  const longHook = "В посте от 25 ноября фонд рассказал о сборе на реабилитацию Ани после сложной операции на позвоночнике и попросил помочь с оплатой курса в центре";
  for (const preset of ["А", "Б", "В", "Г", null] as const) {
    it(`сегмент ${preset ?? "без пресета"}: два варианта, до ${MAX_WORDS} слов, без ссылок и запрещённых фраз`, () => {
      const drafts = buildDrafts({ preset, hook: longHook, topic: "реабилитацию детей", category: "Доставка еды" });
      for (const text of [drafts.A, drafts.B]) {
        expect(wordCount(text)).toBeLessThanOrEqual(MAX_WORDS);
        expect(text).not.toMatch(/https?:\/\/|t\.me|созвон/i);
        expect(bannedIn(text)).toEqual([]);
        expect(hasPlaceholder(text)).toBe(false);
      }
      expect(drafts.A).not.toBe(drafts.B);
    });
  }
  it("без зацепки в тексте остаётся заглушка — отправить нельзя", () => {
    const drafts = buildDrafts({ preset: "В", hook: NOT_FOUND, category: "Автосервис" });
    expect(hasPlaceholder(drafts.A)).toBe(true);
  });
  it("в тексте В — только реальные кейсы студии", () => {
    expect(buildDrafts({ preset: "В", hook: "Заказы только по телефону", category: "Доставка еды" }).A).toContain("Свой Хлеб");
    expect(buildDrafts({ preset: "В", hook: "Запись только по телефону", category: "Автосервис" }).A).toContain("Метод Малова");
  });
  it("касания: день 4 и день 8, потом пауза", () => {
    expect(touchKind(0)).toBe("day4");
    expect(touchKind(1)).toBe("day8");
    expect(touchKind(2)).toBeNull();
    for (const preset of ["А", "Б", "В", "Г"] as const) {
      expect(wordCount(followUpDraft(0, preset))).toBeLessThanOrEqual(MAX_WORDS);
      expect(followUpDraft(1, preset)).toMatch(/не продаю|без предложения/i);
    }
  });
});

describe("пресеты сегментов", () => {
  it("6 критериев 1–5 у каждого пресета", () => {
    for (const preset of PRESETS) {
      for (const value of Object.values(preset.criteria)) expect(value).toBeGreaterThanOrEqual(1), expect(value).toBeLessThanOrEqual(5);
      expect(presetScore(preset)).toBeGreaterThanOrEqual(6);
    }
  });
  it("распознавание: фонд, музей, завод, мебель, автосервис, склад; старые сегменты сопоставлены", () => {
    expect(detectPreset({ name: "Благотворительный фонд «Жизнь»" })).toBe("А");
    expect(detectPreset({ category: "Музей" })).toBe("А");
    expect(detectPreset({ category: "Завод металлоконструкций" })).toBe("Б");
    expect(detectPreset({ category: "Мебельное производство" })).toBe("В");
    expect(detectPreset({ category: "Автосервис" })).toBe("В");
    expect(detectPreset({ category: "Аренда склада" })).toBe("Г");
    expect(detectPreset({ segment: "B3", category: "Что-то" })).toBe("Б");
    expect(detectPreset({ segment: "A1", category: "Что-то" })).toBe("В");
  });
});

describe("правило решения на 50 контактов и итог дня", () => {
  it("меньше 50 — набираем", () => expect(decision50({ sent: 30, replies: 5, calls: 1 }).status).toBe("collect"));
  it("10–15% ответов и созвон — продолжаем", () => expect(decision50({ sent: 50, replies: 6, calls: 1 }).status).toBe("continue"));
  it("меньше 5% — меняем сегмент или текст", () => expect(decision50({ sent: 50, replies: 2, calls: 0 }).status).toBe("change"));
  it("отвечают, но не созваниваются — не цепляет предложение", () => expect(decision50({ sent: 60, replies: 8, calls: 0 }).status).toBe("offer"));
  it("5–10% с созвоном — пограничная зона", () => expect(decision50({ sent: 50, replies: 4, calls: 1 }).status).toBe("watch"));

  const rec = (preset: string, variant: string, replied: boolean): FunnelRecord => ({ preset, variant, replied, interest: false, prototype: false, call: false, proposal: false, prepaid: false });
  it("воронка считает по сегментам и вариантам, итог дня выбирает лучший вариант", () => {
    const records = [
      ...Array.from({ length: 12 }, (_, i) => rec("А", "A", i < 3)),
      ...Array.from({ length: 12 }, (_, i) => rec("А", "B", i < 0)),
    ];
    const table = funnelRows(records);
    expect(table.total.sent).toBe(24);
    expect(table.bySegment[0]).toMatchObject({ key: "А", sent: 24, replies: 3 });
    expect(table.byVariant.find((item) => item.key === "A")?.replyRate).toBe(0.25);
    expect(changeForTomorrow({ sentToday: 30, openTasks: 0, byVariant: table.byVariant, total: table.total })).toMatch(/вариант a/i);
    expect(changeForTomorrow({ sentToday: 30, openTasks: 2, byVariant: table.byVariant, total: table.total })).toMatch(/2 задач/);
  });
});
