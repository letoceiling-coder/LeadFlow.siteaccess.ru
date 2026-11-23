import { describe, expect, it } from "vitest";
import { extractEmails, extractLinks, extractPhones, scanFromPage, siteChaos, siteIsGood, failedScan } from "../src/lib/domain/site-scan";
import { buildCard, reviewComplaint, strategyScore, type QualifyFacts } from "../src/lib/domain/qualify";
import { mapParserOrganization } from "../src/lib/domain/parser-map";
import { buildProposal, packagesFor, proposalText } from "../src/lib/domain/proposal";
import { contactLinks } from "../src/lib/domain/pitch";

const NOW = new Date("2026-11-23T10:00:00Z");
const FILL = " Работаем каждый день с девяти до девяти, адрес и схема проезда ниже, звоните или приезжайте без выходных. Гарантия на все работы и запчасти.";
const scanFull = (input: Parameters<typeof scanFromPage>[0], now?: Date) => scanFromPage({ ...input, text: input.text + FILL }, now);

describe("скан сайта лида", () => {
  const html = `<html><head><meta name="viewport" content="width=device-width"><title>Кардан</title></head><body>
    <a href="mailto:info@kardanural.ru">Почта</a> <a href="tel:8 (343) 363-02-19">Звонок</a>
    <a href="https://t.me/kardan_ural">TG</a> <a href="https://t.me/share/url?url=x">share</a>
    <a href="https://wa.me/79001112233">WA</a> <a href="https://vk.com/share.php?url=x">share</a> <a href="https://vk.com/kardanural">VK</a>
    <img src="logo@2x.png"> <form></form></body></html>`;
  const text = "Ремонт карданов. Балансировка 3 500 ₽. Пишите: info@kardanural.ru © 2019 Кардан";

  it("достаёт почту без мусора из картинок", () => {
    expect(extractEmails(html, text)).toEqual(["info@kardanural.ru"]);
  });
  it("телефон из tel: приводит к +7", () => {
    expect(extractPhones(html)).toEqual(["+73433630219"]);
  });
  it("мессенджеры без кнопок «поделиться»", () => {
    expect(extractLinks(html).map((item) => item.kind)).toEqual(["telegram", "whatsapp", "vk"]);
  });
  it("хаос по нише автосервиса: нет записи, сайт устарел", () => {
    const scan = scanFull({ url: "https://kardan.ru", html, text, httpStatus: 200 }, NOW);
    expect(scan.viewport).toBe(true);
    expect(scan.prices).toBe(true);
    expect(scan.copyrightYear).toBe(2019);
    const chaos = siteChaos(scan, "A2", NOW);
    expect(chaos).toContain("На сайте нет онлайн-записи — только звонок");
    expect(chaos).toContain("Сайт не обновлялся с 2019 года");
    expect(siteIsGood(scan)).toBe(false);
  });
  it("мёртвый домен — факт, временный сбой — нет", () => {
    expect(siteChaos(failedScan("https://x.ru", "net::ERR_NAME_NOT_RESOLVED", NOW), "A2", NOW)).toEqual(["Сайт из карточки не открывается"]);
    expect(siteChaos(failedScan("https://x.ru", "Timeout 45000ms", NOW), "A2", NOW)).toEqual([]);
  });
  it("хороший сайт с записью снижает балл", () => {
    const good = scanFull({ url: "https://clinic.ru", html: `<meta name="viewport"><a href="https://n123.yclients.com">Онлайн-запись</a>`, text: `Стоматология. Записаться онлайн к врачу. Приём 2 000 ₽ © ${NOW.getFullYear()}`, httpStatus: 200 }, NOW);
    expect(siteIsGood(good)).toBe(true);
  });
});

const base: QualifyFacts = {
  name: "ПРО авто", category: "Автосервис", categories: ["Автосервис"], city: "Ростов-на-Дону", address: "ул. 1",
  website: "https://proauto.ru", websiteStatus: "WEBSITE_EXISTS", rating: 5, reviewCount: 528, photoCount: 10,
  services: ["Замена масла — 1 500 ₽", "Диагностика — 2 000 ₽", "Развал — 2 500 ₽", "Шиномонтаж — 3 000 ₽", "Кузовной — 5 000 ₽"],
  features: [], description: null, sourceUrl: null, phones: ["+79885552230"], emails: [], socials: ["https://t.me/79885552230"],
};

describe("отзывы и прайс с карт в скоринге", () => {
  it("жалоба «не дозвониться» становится крючком", () => {
    expect(reviewComplaint(["Отличный сервис", "Полдня не мог дозвониться, трубку не берут"])).toBe("В отзывах пишут, что к вам трудно дозвониться");
    expect(reviewComplaint(["Всё отлично"])).toBeNull();
  });
  it("без AI: 528 отзывов + жалоба + сайт без записи → карточка готова, класс A", () => {
    const scan = scanFull({ url: "https://proauto.ru", html: `<meta name="viewport"><form></form>`, text: `Ремонт двигателей и ходовой, диагностика, шиномонтаж © ${NOW.getFullYear()}`, httpStatus: 200 }, NOW);
    const card = buildCard({ ...base, site: scan, reviews: ["Не дозвониться никогда"] }, null);
    expect(card.chaos[0].text).toBe("В отзывах пишут, что к вам трудно дозвониться");
    expect(card.chaos.some((item) => item.source === "site")).toBe(true);
    expect(card.growth.some((item) => item.text.startsWith("Прайс на картах"))).toBe(true);
    const scored = strategyScore(card, null);
    expect(scored.ready).toBe(true);
    expect(scored.priority).toBe("A");
  });
});

describe("карточка массового сбора", () => {
  it("мессенджеры из socialLinks, messagingLinks и additionalContacts, прайс в услугах", () => {
    const mapped = mapParserOrganization({
      name: "BMW Аста-Авто", externalId: "176023941280", city: "Ростов-на-Дону", categories: ["Автосервис, автотехцентр"], phones: ["+78632002222"], photosCount: 97,
      socialLinks: [{ url: "https://t.me/AstaAuto_bot", type: "telegram" }, { url: "https://wa.me/79613112631", type: "whatsapp" }],
      messagingLinks: { telegram: "https://t.me/AstaAuto_bot", whatsapp: "https://wa.me/79613112631" },
      additionalContacts: ["https://max.ru/id611800624690_bot"],
      products: [{ name: "Диагностика", price: "2 000 ₽" }], amenities: ["Предварительная запись"],
    })!;
    expect(mapped.socials).toEqual(["https://t.me/AstaAuto_bot", "https://wa.me/79613112631", "https://max.ru/id611800624690_bot"]);
    expect(mapped.services[0]).toBe("Диагностика — 2 000 ₽");
    expect(mapped.photoCount).toBe(97);
    expect(mapped.features).toContain("Предварительная запись");
  });
  it("куда писать: сначала Telegram и WhatsApp, звонок последним", () => {
    const links = contactLinks([{ kind: "phone", value: "+79001112233" }, { kind: "social", value: "https://max.ru/u/abc" }, { kind: "social", value: "https://t.me/shop" }], "Привет");
    expect(links[0].kind).toBe("telegram");
    expect(links[links.length - 1].kind).toBe("phone");
    expect(links.some((item) => item.label === "MAX")).toBe(true);
  });
});

describe("КП после ответа", () => {
  it("три пакета от сценария, рекомендуемый — средний", () => {
    const packages = packagesFor({ features: ["a", "b", "c"], priceFrom: 30_000, priceTo: 50_000, days: [3, 7] });
    expect(packages.map((item) => item.priceRub)).toEqual([30_000, 40_000, 65_000]);
    expect(packages.find((item) => item.recommended)?.key).toBe("optimum");
  });
  it("в КП попадают проверенные факты и текст для отправки со ссылкой", () => {
    const card = buildCard({ ...base, reviews: ["не дозвониться"] }, null);
    const proposal = buildProposal({ name: "ПРО авто", city: "Ростов-на-Дону", category: "Автосервис", rating: 5, reviewCount: 528, card, site: null, now: NOW });
    expect(proposal.title).toContain("ПРО авто");
    expect(proposal.seen).toContain("В отзывах пишут, что к вам трудно дозвониться");
    expect(proposal.packages).toHaveLength(3);
    const text = proposalText(proposal, "https://x/kp/abc");
    expect(text).toContain("https://x/kp/abc");
    expect(text).toMatch(/30\s000/);
  });
});

import { parseHuntQuery } from "../src/lib/domain/hunt-query";

describe("задание агенту фразой", () => {
  it("ниша, несколько городов и количество", () => {
    expect(parseHuntQuery("найди автосервисы в Ростове и Краснодаре 50 штук")).toEqual({ cities: ["Ростов-на-Дону", "Краснодар"], category: "Автосервис", count: 50 });
  });
  it("свободная ниша без количества", () => {
    expect(parseHuntQuery("кофейни с доставкой по Самаре")).toEqual({ cities: ["Самара"], category: "Кофейни с доставкой", count: null });
  });
  it("короткие формы городов", () => {
    expect(parseHuntQuery("стоматология спб, мск 20").cities).toEqual(["Москва", "Санкт-Петербург"]);
  });
});

import { mergeScans, subpageLinks } from "../src/lib/domain/site-scan";

describe("внутренние страницы сайта", () => {
  it("находит меню и доставку на том же домене", () => {
    const html = `<a href="#x">Меню</a><a href="https://www.hayao.ru/menu#main">МЕНЮ</a><a href="/delivery">ДОСТАВКА</a><a href="https://vk.com/x">Меню VK</a><a href="/about">О нас</a>`;
    expect(subpageLinks(html, "https://www.hayao.ru/cg")).toEqual(["https://www.hayao.ru/menu", "https://www.hayao.ru/delivery"]);
  });
  it("корзина на странице доставки снимает ложный факт «нет корзины»", () => {
    const main = scanFull({ url: "https://hayao.ru", html: `<meta name="viewport"><a href="/delivery">Доставка</a>`, text: "Ресторан японской кухни. О ресторане, команда, контакты и адрес", httpStatus: 200 }, NOW);
    const sub = scanFull({ url: "https://hayao.ru/delivery", html: `<meta name="viewport">`, text: "Филадельфия 690 ₽ — В корзину. Оформить заказ с доставкой по городу", httpStatus: 200 }, NOW);
    expect(siteChaos(main, "A1", NOW)).toContain("На сайте нет корзины — заказ только по телефону или в мессенджере");
    expect(siteChaos(mergeScans(main, [sub]), "A1", NOW)).not.toContain("На сайте нет корзины — заказ только по телефону или в мессенджере");
  });
  it("ссылка на Яндекс Еду считается корзиной", () => {
    expect(scanFull({ url: "https://s.ru", html: `<a href="https://eda.yandex.ru/r/sushi">Заказать</a>`, text: "Суши и роллы в Краснодаре, доставка каждый день", httpStatus: 200 }, NOW).cart).toBe(true);
  });
});

describe("недорисованные страницы", () => {
  it("пустой текст — не факт хаоса", () => {
    const scan = scanFromPage({ url: "https://yoyo.ru", html: "<div id=root></div>".repeat(50), text: "", httpStatus: 200 }, NOW);
    expect(scan.ok).toBe(false);
    expect(siteChaos(scan, "A1", NOW)).toEqual([]);
  });
  it("самовывоз на странице заказа считается корзиной", () => {
    expect(scanFromPage({ url: "https://yoyo.ru", html: "", text: "YoYo Sushi Краснодар. Доставка и самовывоз. Заберу здесь. Откроемся в 11:00. Улица Невкипелого, 21/5, Краснодар. Контакты +7 918 039 70 23. Используем cookies.", httpStatus: 200 }, NOW).cart).toBe(true);
  });
});

import { collectStatusOf } from "../src/lib/domain/parser-map";
import { keepManualFacts, addManualFact } from "../src/lib/domain/qualify";
import { isPreviewBot } from "../src/lib/domain/proposal";
import { validProxy } from "../src/lib/integrations/openrouter";

describe("надёжность цепочки", () => {
  it("конечные статусы сбора не держат опрос вечно", () => {
    expect(collectStatusOf("done", "running")).toBe("completed");
    expect(collectStatusOf("error", "running")).toBe("failed");
    expect(collectStatusOf("canceled", "running")).toBe("cancelled");
    expect(collectStatusOf("running", "queued")).toBe("running");
    expect(collectStatusOf(undefined, "running")).toBe("running");
  });
  it("своя сеть в городе — признак роста", () => {
    const card = buildCard({ ...base, branches: 4 }, null);
    expect(card.growth.some((item) => item.text === "Своя сеть: 4 точки в городе")).toBe(true);
    expect(buildCard({ ...base, branches: null }, null).growth.some((item) => item.source === "branches")).toBe(false);
  });
  it("ручной факт переживает пересчёт карточки", () => {
    const before = addManualFact(buildCard(base, null), "chaos", "Трубку не берут после 18:00");
    const after = keepManualFacts(before, buildCard(base, null));
    expect(after.chaos.some((item) => item.source === "manual" && item.text === "Трубку не берут после 18:00")).toBe(true);
    expect(keepManualFacts(after, after).chaos.filter((item) => item.source === "manual")).toHaveLength(1);
  });
  it("превью ссылки в мессенджере не считается просмотром КП", () => {
    expect(isPreviewBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isPreviewBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isPreviewBot(null)).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(false);
  });
  it("прокси только http:// с портом или direct", () => {
    expect(validProxy("http://user:pass@82.25.60.43:8888")).toBe("http://user:pass@82.25.60.43:8888");
    expect(validProxy("https://82.25.60.43:8888")).toBeNull();
    expect(validProxy("82.25.60.43:8888")).toBeNull();
    expect(validProxy("direct")).toBe("direct");
  });
});

import http from "node:http";
import { requestJson } from "../src/lib/http";

describe("ошибки прокси понятны человеку", () => {
  it("407 → «прокси требует логин и пароль»", async () => {
    const server = http.createServer();
    server.on("connect", (_req, socket) => socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Tinyproxy\"\r\n\r\n"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await expect(requestJson("https://openrouter.ai/api/v1/key", { proxy: `http://127.0.0.1:${port}`, timeoutMs: 5000 })).rejects.toThrow("Прокси требует логин и пароль");
    server.close();
  });
});
