import { describe, expect, it } from "vitest";
import { extractEmails, extractLinks, extractPhones, scanFromPage, siteChaos, siteIsGood, failedScan } from "../src/lib/domain/site-scan";
import { buildCard, reviewComplaint, strategyScore, type QualifyFacts } from "../src/lib/domain/qualify";
import { mapParserOrganization } from "../src/lib/domain/parser-map";
import { buildProposal, packagesFor, proposalText } from "../src/lib/domain/proposal";
import { contactLinks } from "../src/lib/domain/pitch";

const NOW = new Date("2026-11-23T10:00:00Z");

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
    const scan = scanFromPage({ url: "https://kardan.ru", html, text, httpStatus: 200 }, NOW);
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
    const good = scanFromPage({ url: "https://clinic.ru", html: `<meta name="viewport"><a href="https://n123.yclients.com">Онлайн-запись</a>`, text: `Стоматология. Записаться онлайн к врачу. Приём 2 000 ₽ © ${NOW.getFullYear()}`, httpStatus: 200 }, NOW);
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
    const scan = scanFromPage({ url: "https://proauto.ru", html: `<meta name="viewport"><form></form>`, text: `Ремонт двигателей и ходовой, диагностика, шиномонтаж © ${NOW.getFullYear()}`, httpStatus: 200 }, NOW);
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
    const main = scanFromPage({ url: "https://hayao.ru", html: `<meta name="viewport"><a href="/delivery">Доставка</a>`, text: "Ресторан японской кухни. О ресторане, команда, контакты и адрес", httpStatus: 200 }, NOW);
    const sub = scanFromPage({ url: "https://hayao.ru/delivery", html: `<meta name="viewport">`, text: "Филадельфия 690 ₽ — В корзину. Оформить заказ с доставкой по городу", httpStatus: 200 }, NOW);
    expect(siteChaos(main, "A1", NOW)).toContain("На сайте нет корзины — заказ только по телефону или в мессенджере");
    expect(siteChaos(mergeScans(main, [sub]), "A1", NOW)).not.toContain("На сайте нет корзины — заказ только по телефону или в мессенджере");
  });
  it("ссылка на Яндекс Еду считается корзиной", () => {
    expect(scanFromPage({ url: "https://s.ru", html: `<a href="https://eda.yandex.ru/r/sushi">Заказать</a>`, text: "Суши и роллы в Краснодаре, доставка каждый день", httpStatus: 200 }, NOW).cart).toBe(true);
  });
});
