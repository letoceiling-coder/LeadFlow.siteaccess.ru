import { describe, expect, it } from "vitest";
import { buildCard, priorityOf, qualifyResultSchema, strategyScore, type QualifyFacts } from "../src/lib/domain/qualify";
import { detectSegment } from "../src/lib/domain/segments";
import { bannedIn, buildPitch, contactLinks, nextFollowUpAt } from "../src/lib/domain/pitch";
import { mergeSettings } from "../src/lib/domain/settings";

const base: QualifyFacts = {
  name: "Суши Мастер",
  category: "Доставка еды и обедов",
  categories: ["Суши-бар"],
  city: "Краснодар",
  address: "ул. Красная, 1",
  website: null,
  websiteStatus: "NO_WEBSITE",
  rating: 4.7,
  reviewCount: 146,
  photoCount: 12,
  services: [],
  features: [],
  description: null,
  sourceUrl: "https://yandex.ru/maps/org/1",
  phones: ["+79990001122"],
  emails: [],
  socials: [],
};

describe("сегменты", () => {
  it("узнаёт доставку и автосервис по категории", () => {
    expect(detectSegment("Доставка еды и обедов")).toBe("A1");
    expect(detectSegment("Автосервис, автотехцентр")).toBe("A2");
    expect(detectSegment("Натяжные потолки")).toBe("A3");
    expect(detectSegment("Библиотека")).toBeNull();
  });
});

describe("карточка наблюдения и скоринг", () => {
  it("без AI собирает факты из данных: 146 отзывов и нет сайта", () => {
    const card = buildCard(base, null);
    expect(card.segment).toBe("A1");
    expect(card.money.map((item) => item.text)).toContain("146 отзывов");
    expect(card.chaos[0].source).toBe("websiteStatus");
    expect(card.caseRef).toBe("Доставка, Ростов");
    const scored = strategyScore(card, null);
    // деньги 30 + хаос 25 + контакт 15 + кейс 10
    expect(scored.score).toBe(80);
    expect(scored.ready).toBe(true);
    expect(scored.priority).toBe("A");
  });

  it("отбрасывает факты AI со ссылкой на пустое или несуществующее поле", () => {
    const ai = qualifyResultSchema.parse({
      money: { facts: [{ text: "3 филиала", source: "branches" }, { text: "Дорогое меню", source: "description" }] },
      chaos: { facts: [{ text: "Заказы только по телефону", source: "phones" }] },
      growth: { facts: [] },
    });
    const card = buildCard({ ...base, reviewCount: 10 }, ai);
    expect(card.money).toHaveLength(0);
    expect(card.chaos.map((item) => item.text)).toContain("Заказы только по телефону");
  });

  it("стоп-правило: без факта денег карточка не выше C", () => {
    const card = buildCard({ ...base, reviewCount: 5 }, null);
    const scored = strategyScore(card, qualifyResultSchema.parse({ repeatable: true }));
    expect(scored.ready).toBe(false);
    expect(["C", "D"]).toContain(scored.priority);
  });

  it("штрафы: хороший сайт и нерелевант", () => {
    const card = buildCard(base, null);
    const scored = strategyScore(card, qualifyResultSchema.parse({ goodSiteAlready: true, irrelevant: true }));
    expect(scored.score).toBe(0);
  });

  it("границы приоритетов", () => {
    expect(priorityOf(75, true)).toBe("A");
    expect(priorityOf(74, true)).toBe("B");
    expect(priorityOf(60, true)).toBe("B");
    expect(priorityOf(90, false)).toBe("C");
    expect(priorityOf(39, true)).toBe("D");
  });

  it("расчёт потерь — оценка с суммой", () => {
    const card = buildCard(base, qualifyResultSchema.parse({ avgCheckRub: 1500, lostPerMonth: 20 }));
    expect(card.calc?.lostRub).toBe(30000);
    expect(card.calc?.text).toContain("оценка");
  });
});

describe("питч", () => {
  it("строится из факта и не содержит запрещённых фраз", () => {
    const card = buildCard(base, qualifyResultSchema.parse({ observation: "Заказы принимаете только по телефону, сайта нет.", avgCheckRub: 1500, lostPerMonth: 20 }));
    const text = buildPitch(card);
    expect(text).toContain("Увидел, что заказы принимаете только по телефону, сайта нет. Верно?");
    expect(text.replace(/\s/g, " ")).toContain("30 000 ₽");
    expect(bannedIn(text)).toEqual([]);
  });

  it("ловит запрещённые фразы", () => {
    expect(bannedIn("Здравствуйте! Мы делаем сайты и AI-агентов")).toEqual(["мы делаем сайты", "делаем сайты", "ai-агент"]);
  });

  it("ссылки для ручной отправки", () => {
    const links = contactLinks(
      [
        { kind: "phone", value: "8 (999) 000-11-22" },
        { kind: "social", value: "https://t.me/sushimaster" },
        { kind: "social", value: "https://vk.com/sushimaster?w=wall" },
      ],
      "Привет",
    );
    expect(links.find((item) => item.kind === "whatsapp")?.href).toBe("https://wa.me/79990001122?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
    expect(links.find((item) => item.kind === "telegram")?.href).toBe("https://t.me/sushimaster");
    expect(links.find((item) => item.kind === "vk")?.href).toBe("https://vk.me/sushimaster");
  });

  it("follow-up D+3, D+7, D+14, потом конец", () => {
    const sent = new Date("2026-11-23T10:00:00Z");
    expect(nextFollowUpAt(sent, 0)?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
    expect(nextFollowUpAt(sent, 1)?.toISOString()).toBe("2026-11-30T10:00:00.000Z");
    expect(nextFollowUpAt(sent, 2)?.toISOString()).toBe("2026-12-07T10:00:00.000Z");
    expect(nextFollowUpAt(sent, 3)).toBeNull();
  });
});

describe("настройки охоты", () => {
  it("по умолчанию активный контур и лимит 25, мусор отбрасывается", () => {
    expect(mergeSettings({}).hunt).toEqual({ activeSegments: ["A1", "A2", "B1"], dailyLimit: 25, autoQualify: true, autoQualifyMax: 60 });
    expect(mergeSettings({ hunt: { activeSegments: ["A5", "ZZ"], dailyLimit: 9999 } }).hunt.activeSegments).toEqual(["A5"]);
    expect(mergeSettings({ hunt: { dailyLimit: 9999 } }).hunt.dailyLimit).toBe(25);
  });
});
