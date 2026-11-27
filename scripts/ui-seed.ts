// Демо-данные для проверки интерфейса на ЛОКАЛЬНОЙ базе: аккаунт, ~40 карточек на всех шагах воронки, проекты, история поиска.
// Печатает cookie lf_session для входа без кода. Только localhost.
//   DATABASE_URL=postgresql://localhost:5432/leadflow_ui AUTH_SECRET=… npx tsx scripts/ui-seed.ts
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { DEFAULT_SETTINGS } from "../src/lib/domain/settings";

const url = process.env.DATABASE_URL ?? "";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Только локальная база");
const prisma = new PrismaClient();

const NAMES = [
  ["Симметрия", "Стоматология", "A5"], ["Roomika", "Мебель на заказ", "A4"], ["Ziamo", "Доставка еды", "A1"], ["Шаурма Чили", "Фастфуд", "A1"],
  ["Автотехцентр Профи", "Автосервис", "A2"], ["Потолок Плюс", "Натяжные потолки", "A3"], ["Глэмп Лес", "Глэмпинг", "A6"], ["Суши Мастер", "Доставка еды", "A1"],
  ["Дентал Лайн", "Стоматология", "A5"], ["Кухни Юга", "Кухни на заказ", "A4"], ["Шиномонтаж 24", "Автосервис", "A2"], ["Пекарня Хлебница", "Пекарня", "A1"],
  ["Клиника Здоровье", "Медцентр", "A5"], ["Окна Дон", "Окна", "A3"], ["База Берег", "База отдыха", "A6"], ["Бургер Хаус", "Бургерная", "A1"],
  ["Детейлинг Блеск", "Детейлинг", "A2"], ["Мастер на час", "Ремонт квартир", "A3"], ["Ювелир Голд", "Ювелирный", "A4"], ["Вет Друг", "Ветклиника", "A5"],
  ["Пицца Нова", "Пиццерия", "A1"], ["Кровля Про", "Кровля", "A3"], ["Салон Штор", "Салон штор", "A4"], ["Кафе Уют", "Кафе", "A1"],
  ["Электро Монтаж", "Электромонтаж", "A3"], ["Автомойка Волна", "Автомойка", "A2"], ["Косметология Лик", "Косметолог", "A5"], ["Роллы Дом", "Суши", "A1"],
  ["Двери Мира", "Двери", "A3"], ["Шубы Север", "Шубы", "A4"], ["Столовая №1", "Столовая", "A1"], ["Клининг Чисто", "Клининг", "A3"],
  ["Кузовной Центр", "Кузовной ремонт", "A2"], ["Медцентр Вита", "Медцентр", "A5"], ["Кулинария Вкус", "Кулинария", "A1"], ["Сантехник Про", "Сантехник", "A3"],
  ["Ресторан Терраса", "Ресторан", "A1"], ["Ремонт Авто Юг", "Ремонт авто", "A2"], ["Одежда Стиль", "Одежда", "A4"], ["Глэмпинг Небо", "Глэмпинг", "A6"],
] as const;
const CITIES = ["Ростов-на-Дону", "Краснодар", "Самара", "Казань", "Москва"];
// Статусы по шагам: сколько карточек положить на каждый.
const PLAN: [string, number][] = [["new", 12], ["approved", 5], ["sent", 7], ["replied", 4], ["demo", 3], ["call", 2], ["estimate", 2], ["won", 2], ["rejected", 3]];
const PRESETS = ["В", "В", "В", "Б", "А", "Г"];

const day = 86400000;
(async () => {
  const email = "ui@local.test";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await prisma.user.create({ data: { email, name: "Никита Демо", passwordHash: "-" } });
  let membership = await prisma.membership.findFirst({ where: { userId: user.id } });
  if (!membership) {
    const tenant = await prisma.tenant.create({ data: { name: "Студия neeklo", slug: `ui-${Date.now()}`, settings: DEFAULT_SETTINGS as object } });
    membership = await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
  }
  const tenantId = membership.tenantId;
  await prisma.project.deleteMany({ where: { tenantId } });
  await prisma.outreach.deleteMany({ where: { tenantId } });
  await prisma.organization.deleteMany({ where: { tenantId, source: "ui-seed" } });

  let n = 0;
  const now = Date.now();
  for (const [status, count] of PLAN) {
    for (let i = 0; i < count; i += 1, n += 1) {
      const [name, category, segment] = NAMES[n % NAMES.length];
      const city = CITIES[n % CITIES.length];
      const reviews = 40 + ((n * 37) % 400);
      const org = await prisma.organization.create({
        data: {
          tenantId, source: "ui-seed", externalId: `ui-${n}`, name, city, category, categories: [category], reviewCount: reviews, rating: 4.2 + (n % 8) / 10,
          websiteStatus: n % 3 ? "NO_WEBSITE" : "SOCIAL_ONLY", address: `ул. Демо, ${n + 1}`, sourceUrl: "https://yandex.ru/maps",
          contacts: { create: [{ tenantId, type: "phone", value: `+7999000${String(2000 + n)}` }, ...(n % 2 ? [{ tenantId, type: "social", value: `https://t.me/demo_${n}` }] : [])] },
        },
      });
      const grade = n % 5 === 0 ? "B" : "A";
      const sentAt = ["new", "approved"].includes(status) ? null : new Date(now - ((n % 9) + 1) * day);
      const outreach = await prisma.outreach.create({
        data: {
          tenantId, organizationId: org.id, segment, score: 60 + ((n * 7) % 38), priority: grade, grade, preset: PRESETS[n % PRESETS.length], cardStatus: "ready", status,
          card: {
            segment, observation: "Заказы принимают только по телефону, меню в картинках в VK.",
            money: [{ text: `${reviews} отзывов, 2 филиала`, source: "Яндекс Карты", kind: "fact" }],
            chaos: [{ text: "Нет сайта, заказы в личке", source: "Яндекс Карты", kind: "fact" }],
            growth: [], calc: null, caseRef: null, contact: [{ kind: "phone", value: `+7999000${2000 + n}` }], features: [],
          },
          sentAt, channel: sentAt ? (n % 2 ? "telegram" : "whatsapp") : null,
          nextFollowUpAt: status === "sent" ? new Date(now + ((n % 5) - 2) * day) : null,
          repliedAt: ["replied", "demo", "call", "estimate", "won"].includes(status) ? new Date(now - (n % 4) * day) : null,
          rejectReason: status === "rejected" ? "Не наш клиент" : null,
          qualifiedAt: new Date(now - ((n % 12) + 1) * day),
        },
      });
      if (["estimate", "won", "call"].includes(status)) {
        const stage = status === "won" ? (n % 2 ? "in_work" : "prepaid") : status === "estimate" ? "estimate" : "brief";
        await prisma.project.create({
          data: {
            tenantId, organizationId: org.id, outreachId: outreach.id, title: `Сайт · ${name}`, product: "Сайт с заказами", stage, amount: 40000 + (n % 6) * 15000,
            deadlineAt: new Date(now + ((n % 10) + 2) * day), source: "hunt",
            checklist: [{ id: "1", title: "Бриф", done: true }, { id: "2", title: "Смета", done: stage !== "brief" }, { id: "3", title: "Дизайн", done: stage === "in_work" }, { id: "4", title: "Запуск", done: false }],
          },
        });
      }
    }
  }
  for (let i = 0; i < 3; i += 1) {
    await prisma.project.create({ data: { tenantId, title: ["Mini App · Кофейня", "Видео · Фонд Добро", "Радар · Агентство"][i], product: "Ручной проект", stage: ["brief", "estimate", "done"][i], amount: [60000, 120000, 35000][i], deadlineAt: new Date(now + (i * 5 + 3) * day), source: "manual", checklist: [{ id: "1", title: "Бриф", done: true }, { id: "2", title: "Смета", done: i > 0 }] } });
  }

  const session = await prisma.session.create({ data: { userId: user.id, expiresAt: new Date(now + 14 * day) } });
  const token = await new SignJWT({ sub: user.id, tid: tenantId, mid: membership.id, sid: session.id, role: membership.role })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("14d").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  console.log(JSON.stringify({ tenantId, cards: n, cookie: token }));
  await prisma.$disconnect();
})();
