import { describe, expect, it } from "vitest";
import {
  channelContacts,
  channelDossier,
  extractContacts,
  judgeChannel,
  judgeContent,
  mentionsCity,
  normalizePhone,
  normalizeUsername,
  searchPhrases,
  siteDomain,
  telegramFacts,
} from "../src/lib/domain/telegram-facts";
import { dedupeKeys, nameProbe, normalizeOrgName, phoneTail, sameOrganization } from "../src/lib/domain/dedupe";
import { contactKinds } from "../src/lib/domain/agent-filters";

describe("контакты из текста канала", () => {
  it("сайт, телефон, почта, @ник и t.me-ссылка; свой ник и соцсети отбрасываются", () => {
    const text = `Благотворительный фонд «Свет». Сайт: www.fond-svet.ru/help
Пожертвовать: https://fond-svet.ru/donate
По вопросам сотрудничества — @svet_manager или t.me/anna_pr, почта info@fond-svet.ru
Тел.: +7 (495) 123-45-67, 8 916 555 44 33. Мы в ВК: vk.com/fondsvet, @fondsvet`;
    const result = extractContacts(text, "@fondsvet");
    expect(result.websites).toEqual(["https://fond-svet.ru"]);
    expect(result.emails).toEqual(["info@fond-svet.ru"]);
    expect(result.usernames.sort()).toEqual(["anna_pr", "svet_manager"]);
    expect(result.phones).toEqual(["+74951234567", "+79165554433"]);
  });
  it("домен из почты не считается сайтом, ник из почты — не @ник", () => {
    const result = extractContacts("пишите на hello@museum.ru");
    expect(result.websites).toEqual([]);
    expect(result.usernames).toEqual([]);
    expect(result.emails).toEqual(["hello@museum.ru"]);
  });
  it("служебные ссылки Telegram не контакты", () => {
    expect(extractContacts("t.me/joinchat/AAAA t.me/addstickers/x t.me/share/url @museum_feedback_bot").usernames).toEqual([]);
  });
  it("нормализация телефона и ника", () => {
    expect(normalizePhone("8 (812) 000-11-22")).toBe("+78120001122");
    expect(normalizePhone("9161234567")).toBe("+79161234567");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizeUsername("https://t.me/Museum_SPB/123")).toBe("museum_spb");
    expect(normalizeUsername("@ab")).toBeNull();
    expect(siteDomain("HTTPS://WWW.Fond.ru/a")).toBe("fond.ru");
  });
  it("из постов — только повторяющиеся или «пишите…» контакты, описание — всегда", () => {
    const posts = [
      { text: "Спасибо нашему партнёру @random_guest за концерт" },
      { text: "Заявки на волонтёрство: пишите @fond_help" },
      { text: "Подробнее на fond.ru" },
      { text: "Отчёт на fond.ru" },
    ];
    const result = channelContacts("Звоните +7 900 111-22-33", posts, "fond");
    expect(result.usernames).toEqual(["fond_help"]);
    expect(result.websites).toEqual(["https://fond.ru"]);
    expect(result.phones).toEqual(["+79001112233"]);
  });
});

describe("досье канала", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  it("последний пост и частота", () => {
    const posts = [
      { date: "2026-11-26T10:00:00Z", text: "a" },
      { date: "2026-11-19T10:00:00Z", text: "b" },
      { date: "2026-11-12T10:00:00Z", text: "c" },
    ];
    const dossier = channelDossier(posts, now);
    expect(dossier.daysSinceLastPost).toBe(1);
    expect(dossier.postsPerWeek).toBe(1);
    expect(dossier.active).toBe(true);
    expect(dossier.summary).toContain("вчера");
  });
  it("без постов — неактивен", () => {
    expect(channelDossier([], now).active).toBe(false);
  });
  it("заброшенный больше года канал отсеивается", () => {
    expect(judgeContent("", [{ date: "2024-01-01T00:00:00Z", text: "x" }], now).ok).toBe(false);
    expect(judgeContent("", [{ date: "2026-11-01T00:00:00Z", text: "Отчёт фонда за октябрь" }], now).ok).toBe(true);
  });
});

describe("отбор каналов, похожих на организации", () => {
  const peer = (title: string, extra: Partial<{ type: string; username: string | null; members: number }> = {}) => ({
    type: "channel",
    username: "some_channel",
    members: 1500,
    title,
    ...extra,
  });
  it("фонд и музей проходят, с бонусом за нишу", () => {
    expect(judgeChannel(peer("Благотворительный фонд «Дом с маяком»"), "благотворительный фонд").ok).toBe(true);
    expect(judgeChannel(peer("Музей Фаберже"), "музей").score).toBeGreaterThan(judgeChannel(peer("Котики"), "музей").score);
  });
  it("агрегаторы, складчины, боты, люди, мелочь отбрасываются", () => {
    expect(judgeChannel(peer("Новости Москвы 24"), "фонд").ok).toBe(false);
    expect(judgeChannel(peer("Складчины курсов"), "фонд").ok).toBe(false);
    expect(judgeChannel(peer("Помощник", { username: "help_bot" }), "фонд").ok).toBe(false);
    expect(judgeChannel(peer("Анна", { type: "user" }), "фонд").ok).toBe(false);
    expect(judgeChannel(peer("Фонд", { members: 5 }), "фонд").ok).toBe(false);
    expect(judgeChannel(peer("Фонд", { username: null }), "фонд").ok).toBe(false);
  });
  it("афиши «куда сходить» — не организация", () => {
    expect(judgeChannel(peer("Куда пойти в Казани // Афиша. Театры. Музеи"), "музей", "Казань").ok).toBe(false);
  });
  it("«Новости фонда» — не агрегатор", () => {
    expect(judgeChannel(peer("Новости фонда «Вера»"), "фонд").ok).toBe(true);
  });
  it("мемориальный музей не путается с мемами", () => {
    expect(judgeChannel(peer("Мемориальный музей космонавтики"), "музей").ok).toBe(true);
  });
});

describe("поисковые фразы", () => {
  it("ниша, город и синонимы без повторов, не больше лимита", () => {
    const phrases = searchPhrases("благотворительный фонд", "Казань", 8);
    expect(phrases[0]).toBe("благотворительный фонд Казань");
    expect(phrases).toContain("благотворительный фонд");
    expect(phrases).toContain("фонд помощи Казань");
    expect(phrases.length).toBe(8);
    expect(new Set(phrases.map((p) => p.toLowerCase())).size).toBe(phrases.length);
  });
  it("без города — ниша и синонимы", () => {
    expect(searchPhrases("музей")).toContain("краеведческий музей");
  });
  it("местный канал выше федерального при заданном городе", () => {
    const peer = (title: string) => ({ type: "channel", username: "x_museum", members: 5000, title });
    expect(judgeChannel(peer("Музей соцбыта. Казань"), "музей", "Казань").score).toBeGreaterThan(judgeChannel(peer("Русский музей"), "музей", "Казань").score);
  });
  it("город в тексте канала", () => {
    expect(mentionsCity("Музей истории Казани", "Казань")).toBe(true);
    expect(mentionsCity("Музей Москвы", "Казань")).toBe(false);
  });
});

describe("telegramFacts — контракт с квалификацией", () => {
  it("свежие посты с текстом, без пустых и коротких", () => {
    const raw = {
      telegram: {
        username: "fond",
        title: "Фонд",
        members: 100,
        posts: [
          { id: 1, date: "2026-11-01T00:00:00Z", text: "Старый пост про сбор на лечение Маши", link: "https://t.me/fond/1" },
          { id: 2, date: "2026-11-20T00:00:00Z", text: "", link: "https://t.me/fond/2" },
          { id: 3, date: "2026-11-25T00:00:00Z", text: "Открыли новый центр реабилитации в Казани", link: "https://t.me/fond/3" },
        ],
      },
    };
    const facts = telegramFacts(raw);
    expect(facts.map((f) => f.link)).toEqual(["https://t.me/fond/3", "https://t.me/fond/1"]);
  });
  it("мусор на входе — пустой список", () => {
    expect(telegramFacts(null)).toEqual([]);
    expect(telegramFacts({ telegram: "x" })).toEqual([]);
    expect(telegramFacts({ reviews: [] })).toEqual([]);
  });
});

describe("дедупликация между источниками", () => {
  it("название без формы собственности и кавычек", () => {
    expect(normalizeOrgName("АНО «Дом с маяком»")).toBe("дом с маяком");
    expect(normalizeOrgName("Благотворительный фонд \"Дом с маяком\"")).toBe("дом с маяком");
    expect(nameProbe("Музей истории Казани")).toBe("истории");
  });
  it("канал совпадает с организацией с карт по домену, телефону, нику и названию+городу", () => {
    const maps = dedupeKeys({
      name: "Благотворительный фонд «Дом с маяком»",
      city: "Москва",
      website: "https://www.mayak.help/",
      contacts: [
        { type: "phone", value: "+7 (495) 123-45-67" },
        { type: "social", value: "https://t.me/mayak_help" },
      ],
    });
    expect(sameOrganization(dedupeKeys({ website: "mayak.help/donate" }), maps)?.by).toBe("domain");
    expect(sameOrganization(dedupeKeys({ phones: ["84951234567"] }), maps)?.by).toBe("phone");
    expect(sameOrganization(dedupeKeys({ usernames: ["@Mayak_Help"] }), maps)?.by).toBe("telegram");
    expect(sameOrganization(dedupeKeys({ name: "АНО Дом с маяком", city: "г. Москва" }), maps)?.by).toBe("name");
  });
  it("разные организации не склеиваются; общие домены и короткие названия не ключ", () => {
    const a = dedupeKeys({ name: "Фонд Вера", city: "Москва", website: "https://vk.com/fondvera" });
    const b = dedupeKeys({ name: "Фонд Надежда", city: "Москва", website: "https://vk.com/fondnadezhda" });
    expect(a.domains).toEqual([]);
    expect(a.nameCity).toBeNull();
    expect(sameOrganization(a, b)).toBeNull();
    expect(dedupeKeys({ name: "Дом с маяком" }).nameCity).toBeNull();
  });
  it("хвост телефона для поиска в базе", () => {
    expect(phoneTail("+7 (495) 123-45-67")).toBe("4951234567");
    expect(phoneTail("123")).toBeNull();
  });
});

describe("тип контакта telegram", () => {
  it("«@username» с типом telegram — это Telegram, а не почта", () => {
    expect(contactKinds("telegram", "@fond_help")).toContain("telegram");
    expect(contactKinds("telegram", "@fond_help")).not.toContain("email");
  });
});

describe("сайт организации среди ссылок канала", () => {
  it("свой сайт по нику или названию, СМИ и спонсоры — нет", async () => {
    const { officialSite } = await import("../src/lib/domain/telegram-facts");
    expect(officialSite(["https://ria.ru", "https://aleshafond.ru"], "aleshafond_ru")).toBe("https://aleshafond.ru");
    expect(officialSite(["https://zakatfund.ru"], "fundzakat")).toBe("https://zakatfund.ru");
    expect(officialSite(["https://sofp.ru"], "sofp66")).toBe("https://sofp.ru");
    expect(officialSite(["https://avzvet.ru", "https://ghopecatalog.ru"], "fondgh", "Дарящие надежду")).toBeNull();
    expect(officialSite(["https://podsolnuh-fond.ru"], "fond_x", "Фонд Подсолнух")).toBe("https://podsolnuh-fond.ru");
  });
  it("кириллический домен целиком, поддомен → корень, платёжки и СМИ не сайт", async () => {
    const officialSiteOf = (await import("../src/lib/domain/telegram-facts")).officialSite;
    const result = extractContacts("Сайт: своихнебросаем2022.рф, оплата qr.nspk.ru/abc, ria.ru/news");
    expect(result.websites).toEqual(["https://своихнебросаем2022.рф"]);
    expect(officialSiteOf(result.websites, "svoih_ne_brosaem_rf")).toBe("https://своихнебросаем2022.рф");
    expect(officialSiteOf(["https://ticket.rusmuseum.ru"], "rusmuseum")).toBe("https://rusmuseum.ru");
  });
  it("один пост с промокодом не делает фонд складчиной", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const posts = [
      { date: "2026-11-26T10:00:00Z", text: "Промокод партнёра на корм" },
      { date: "2026-11-25T10:00:00Z", text: "Сбор на лечение" },
      { date: "2026-11-24T10:00:00Z", text: "Отчёт" },
    ];
    expect(judgeContent(null, posts, now).ok).toBe(true);
  });
});
