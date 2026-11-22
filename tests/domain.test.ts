import { describe, expect, it } from "vitest";
import { can } from "../src/lib/domain/rbac";
import { computeLeadScore, validateWeights, DEFAULT_WEIGHTS } from "../src/lib/domain/scoring";
import { classifyWebsite, isPublicHttpUrl } from "../src/lib/domain/website";
import { decideSend, personalizeTemplate } from "../src/lib/domain/compliance";
import { buildSiteBrief } from "../src/lib/domain/brief";
import { mapParserOrganization } from "../src/lib/domain/parser-map";
import { evaluateConditions, validateAutomation } from "../src/lib/domain/automation";
import { needsLargeConfirm } from "../src/lib/domain/schemas";
import { csvCell } from "../src/lib/domain/csv";
import { extractJson } from "../src/lib/integrations/openrouter";
import { contactKinds, hasContactKind, nextSearchSize, samePlace, searchSampleSize, userAskedForOffer, userAskedToPublish, userAskedToSend } from "../src/lib/domain/agent-filters";
import { buildCommercialOffer, formatPhone, offerTemplateBody, readOptOut, signOptOut, telegramLink } from "../src/lib/domain/offer";

describe("права", () => {
  it("владелец может публиковать, наблюдатель нет", () => {
    expect(can("OWNER", "sites.publish")).toBe(true);
    expect(can("VIEWER", "sites.publish")).toBe(false);
    expect(can("VIEWER", "org.read")).toBe(true);
    expect(can("ANALYST", "search.manage")).toBe(true);
    expect(can("OPERATOR", "campaigns.approve")).toBe(false);
    expect(can("MANAGER", "comms.manage")).toBe(true);
  });
});

describe("оценка лида", () => {
  it("считает факты и не награждает неизвестный потенциал", () => {
    const result = computeLeadScore({
      websiteStatus: "NO_WEBSITE",
      hasPhone: true,
      hasEmail: false,
      rating: 4.8,
      reviewCount: 30,
      hasAddress: true,
      hasCategory: true,
      photoCount: null,
      services: ["Осмотр"],
      commercialPotential: null,
    });
    expect(result.score).toBe(75);
    expect(result.factors.find((item) => item.key === "commercialPotential")?.kind).toBe("unknown");
    expect(result.disclaimer).toMatch(/не гарантия/i);
  });

  it("не даёт сумме весов превысить 100", () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, noWebsite: 90 })).toMatch(/100/);
  });
});

describe("сайт", () => {
  it("отличает пустой сайт, соцсеть и агрегатор", () => {
    expect(classifyWebsite(null)).toBe("NO_WEBSITE");
    expect(classifyWebsite("https://vk.com/clinic")).toBe("SOCIAL_ONLY");
    expect(classifyWebsite("https://vk.me/shop")).toBe("SOCIAL_ONLY");
    expect(classifyWebsite("https://max.ru/shop")).toBe("SOCIAL_ONLY");
    expect(classifyWebsite("https://yandex.ru/maps/org/1")).toBe("AGGREGATOR_ONLY");
    expect(classifyWebsite("https://clinic.example")).toBe("WEBSITE_EXISTS");
  });

  it("запрещает внутренние адреса", () => {
    expect(isPublicHttpUrl("http://127.0.0.1/admin").ok).toBe(false);
    expect(isPublicHttpUrl("http://10.0.0.5").ok).toBe(false);
    expect(isPublicHttpUrl("http://192.168.0.2").ok).toBe(false);
    expect(isPublicHttpUrl("https://clinic.example").ok).toBe(true);
  });
});

describe("коммуникации", () => {
  const base = {
    approved: true,
    suppressed: false,
    doNotContact: false,
    channel: "email",
    channelConnected: true,
    lawfulBasis: "consent" as const,
    recentCount: 0,
    limit: 1,
    campaign: false,
    campaignApproved: false,
    legalBasisConfirmed: false,
  };

  it("не отправляет без подтверждения и без основания", () => {
    expect(decideSend({ ...base, approved: false }).ok).toBe(false);
    expect(decideSend({ ...base, lawfulBasis: null }).ok).toBe(false);
    expect(decideSend({ ...base, suppressed: true }).ok).toBe(false);
  });

  it("требует согласие для WhatsApp и не считает карту основанием", () => {
    expect(decideSend({ ...base, channel: "whatsapp", lawfulBasis: "contract" }).ok).toBe(false);
    expect(decideSend({ ...base, channel: "whatsapp" }).ok).toBe(true);
  });

  it("убирает пустые подстановки и не выдумывает их", () => {
    const result = personalizeTemplate("Здравствуйте, {{name}}. {{email}}", { name: "Клиника", email: null });
    expect(result.text).toBe("Здравствуйте, Клиника.");
    expect(result.missing).toContain("email");
  });
});

describe("бриф и парсер", () => {
  it("не подставляет выдуманный телефон", () => {
    const brief = buildSiteBrief(
      {
        name: "Клиника",
        category: "стоматология",
        city: "Казань",
        region: null,
        address: null,
        phones: [],
        emails: [],
        socials: [],
        website: null,
        websiteStatus: "NO_WEBSITE",
        rating: null,
        reviewCount: null,
        services: [],
        features: [],
        hours: null,
        description: null,
        sourceUrl: null,
      },
      { siteType: "clinic", language: "ru", style: null, pages: [], wishes: null },
    );
    expect(brief).toContain("Телефоны: неизвестно");
    expect(brief).toContain("Не копируй");
    expect(brief).toContain("премиальн");
    expect(brief).not.toMatch(/\+7\s*9/);
  });

  it("разбирает карточку из документации", () => {
    const mapped = mapParserOrganization({
      id: "0b6f",
      externalId: "1234567890",
      source: "yandex",
      name: "Клиника «Улыбка»",
      city: "Краснодар",
      region: "Краснодарский край",
      category: "стоматология",
      categories: ["Стоматологическая клиника"],
      address: "ул. Красная, 1",
      phones: ["+7 861 000-00-00"],
      website: "https://example.ru",
      rating: 4.8,
      reviewCount: 312,
      coordinates: { lat: 45.03, lon: 38.97 },
      sourceUrl: "https://yandex.ru/maps/org/1",
    });
    expect(mapped?.externalId).toBe("1234567890");
    expect(mapped?.phones).toEqual(["+7 861 000-00-00"]);
    expect(mapped?.websiteStatus).toBe("WEBSITE_EXISTS");
    expect(mapped?.lat).toBe(45.03);
  });
});

describe("автоматизация", () => {
  it("запрещает отправку и цикл анализа", () => {
    expect(validateAutomation({ trigger: "organization.created", actions: [{ type: "send_message" }] })).toMatch(/не может отправлять/);
    expect(validateAutomation({ trigger: "analysis.completed", actions: [{ type: "enqueue_analysis" }] })).toMatch(/зациклится/);
    expect(evaluateConditions({ all: [{ field: "score", op: "gte", value: 70 }] }, { score: 80 })).toBe(true);
    expect(evaluateConditions({ all: [{ field: "score", op: "gte", value: 70 }] }, { score: 10 })).toBe(false);
  });
});

describe("прочее", () => {
  it("просит подтверждение большого поиска", () => {
    expect(needsLargeConfirm(200)).toBe(true);
    expect(needsLargeConfirm(20, 1)).toBe(false);
    expect(needsLargeConfirm(50, 5)).toBe(true);
  });

  it("нейтрализует формулы в CSV", () => {
    expect(csvCell("=cmd")).toBe("'=cmd");
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it("достаёт JSON из ответа модели", () => {
    expect(extractJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });
});

describe("фильтры агента", () => {
  it("узнаёт контакты и просьбу опубликовать", () => {
    expect(contactKinds("email", "a@b.ru")).toContain("email");
    expect(contactKinds("social", "https://t.me/shop")).toEqual(expect.arrayContaining(["telegram", "social"]));
    expect(contactKinds("social", "https://vk.com/shop")).toContain("vk");
    expect(contactKinds("social", "https://vk.me/avtoservice_stavropol")).toContain("vk");
    expect(searchSampleSize(5, 5, true)).toBe(30);
    expect(searchSampleSize(5, 5, false)).toBe(5);
    expect(searchSampleSize(50, 50, false)).toBe(50);
    expect(nextSearchSize(30, 2, 5, 30)).toBe(60);
    expect(nextSearchSize(30, 5, 5, 30)).toBeNull();
    expect(nextSearchSize(30, 2, 5, 8)).toBeNull();
    expect(contactKinds("social", "https://max.ru/shop")).toContain("max");
    expect(hasContactKind([{ type: "social", value: "https://vk.com/shop" }], ["email", "vk"])).toBe(true);
    expect(hasContactKind([{ type: "phone", value: "+7" }], ["email"])).toBe(false);
    expect(samePlace("Киров", "киров")).toBe(true);
    expect(samePlace("Ставрополь", "Киров")).toBe(false);
    expect(userAskedToPublish("создай сайты и опубликуй")).toBe(true);
    expect(userAskedToPublish("только ссылку на просмотр")).toBe(false);
    expect(userAskedForOffer("подготовь КП и отправь")).toBe(true);
    expect(userAskedToSend("отправь тестовую копию")).toBe(true);
    expect(userAskedToSend("только подготовь КП")).toBe(false);
    expect(can("ADMIN", "agent.use")).toBe(true);
    expect(can("VIEWER", "agent.use")).toBe(false);
  });
});

describe("коммерческое предложение", () => {
  it("собирает ссылку на сайт и контакты для ответа", () => {
    expect(telegramLink("@IgorKutsaev")).toBe("https://t.me/IgorKutsaev");
    expect(formatPhone("89996371182")?.href).toBe("tel:+79996371182");
    const optOutUrl = "https://leadflow.siteaccess.ru/opt-out/token";
    const offer = buildCommercialOffer({
      name: "Автосервис",
      city: "Ставрополь",
      category: "автосервис",
      siteUrl: "https://lovable.siteaccess.ru/s/avtoservis-demo-jhjqf/",
      optOutUrl,
      reply: {
        phone: formatPhone("89996371182"),
        telegram: telegramLink("@IgorKutsaev"),
        max: "https://max.ru/u/example",
        email: "support@shotbro.ru",
      },
    });
    expect("text" in offer).toBe(true);
    if (!("text" in offer)) return;
    expect(offer.text).toContain("https://lovable.siteaccess.ru/s/avtoservis-demo-jhjqf/");
    expect(offer.text).toContain("«Автосервис»");
    expect(offer.text).toContain("напоминание о следующем ТО");
    expect(offer.subject).toContain("«Автосервис»");
    expect(offer.preheader.length).toBeGreaterThan(20);
    expect(offer.text).toContain(optOutUrl);
    expect(offer.html).toContain("Отписаться от рассылки");
    expect(offer.html).toContain("SHOTBRO");
    expect(offer.html).not.toContain("<script");
    const extended = buildCommercialOffer({
      name: "Автосервис",
      city: "Ставрополь",
      category: "автосервис",
      siteUrl: "https://lovable.siteaccess.ru/s/avtoservis-demo-jhjqf/",
      optOutUrl,
      format: "extended",
      reply: {
        phone: formatPhone("89996371182"),
        telegram: telegramLink("@IgorKutsaev"),
        max: "https://max.ru/u/example",
        email: "support@shotbro.ru",
      },
    });
    if ("text" in extended) {
      expect(extended.text).toContain("Видеореклама");
      expect(extended.text).toContain("Интернет-магазины");
      expect(extended.text).toContain("AI-ассистенты");
    }
    const salon = buildCommercialOffer({
      name: "Линия",
      city: "Ставрополь",
      category: "салон красоты",
      siteUrl: "https://lovable.siteaccess.ru/s/avtoservis-demo-jhjqf/",
      optOutUrl,
      reply: {
        phone: formatPhone("89996371182"),
        telegram: telegramLink("@IgorKutsaev"),
        max: "https://max.ru/u/example",
        email: "support@shotbro.ru",
      },
    });
    if ("text" in salon) expect(salon.text).toContain("программа лояльности");
    const hidden = buildCommercialOffer({
      name: "Маяк",
      city: "Ставрополь",
      category: "автосервис",
      siteUrl: "https://lovable.siteaccess.ru/s/avtoservis-demo-jhjqf/",
      optOutUrl,
      siteFact: "none",
      reply: {
        phone: formatPhone("89996371182"),
        telegram: null,
        max: null,
        email: "support@shotbro.ru",
      },
    });
    if ("text" in hidden) expect(hidden.text).toContain("Собственного сайта в открытых данных мы не нашли");
    expect(offer.text).not.toContain("Собственного сайта в открытых данных мы не нашли");
    expect(offer.text).toContain("https://t.me/IgorKutsaev");
    expect(offer.text).toContain("https://max.ru/u/example");
    expect(offer.text).toContain("+7 999 637-11-82");
    expect(offer.text).toContain("support@shotbro.ru");
    expect(offer.text).not.toMatch(/₽|hello@example/);
    expect(offerTemplateBody()).toContain("{{opt_out}}");
    const token = signOptOut({ tenantId: "t1", organizationId: "o1", messageId: "m1" }, "secret");
    expect(readOptOut(token, "secret")).toEqual({ tenantId: "t1", organizationId: "o1", messageId: "m1" });
    expect(readOptOut(`${token}x`, "secret")).toBeNull();
  });

  it("не собирает предложение без публичной ссылки", () => {
    const offer = buildCommercialOffer({
      name: "Маяк",
      city: "Ставрополь",
      category: "автосервис",
      siteUrl: "",
      optOutUrl: "https://leadflow.siteaccess.ru/opt-out/token",
      reply: { phone: formatPhone("89996371182"), telegram: null, max: null, email: "support@shotbro.ru" },
    });
    expect("error" in offer).toBe(true);
  });
});
