import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// Вымышленные организации для сценариев. Ровно как отдаёт парсер сейчас: у части нет отзывов.
const rows: [string, string, number | null, string, string | null, string[]][] = [
  ["E2E Бургеры Ready", "Бургерная", 240, "NO_WEBSITE", null, ["+79990001001"]],
  ["E2E Пицца Ready", "Пиццерия", 180, "NO_WEBSITE", null, ["+79990001002", "https://t.me/e2e_pizza"]],
  ["E2E Шаурма Check", "Фастфуд", null, "SOCIAL_ONLY", "https://vk.com/e2e_shawarma", ["+79990001003"]],
  ["E2E Автосервис Check", "Автосервис", null, "NO_WEBSITE", null, ["+79990001004"]],
  ["E2E Ресторан с сайтом", "Ресторан", 400, "WEBSITE_EXISTS", "https://example.com", ["+79990001005"]],
];
(async () => {
  const tenant = await prisma.tenant.findFirstOrThrow();
  const ids: string[] = [];
  for (const [i, [name, category, reviews, ws, website, contacts]] of rows.entries()) {
    const org = await prisma.organization.upsert({
      where: { tenantId_source_externalId: { tenantId: tenant.id, source: "e2e", externalId: `e2e-${i}` } },
      update: {},
      create: { tenantId: tenant.id, externalId: `e2e-${i}`, source: "e2e", name, city: "Краснодар", category, categories: [category], reviewCount: reviews, rating: reviews ? 4.6 : null, websiteStatus: ws, website, address: "ул. Тестовая, 2", sourceUrl: "https://example.com/org" },
    });
    for (const value of contacts) await prisma.organizationContact.upsert({ where: { organizationId_type_value: { organizationId: org.id, type: value.startsWith("+") ? "phone" : "social", value } }, update: {}, create: { tenantId: tenant.id, organizationId: org.id, type: value.startsWith("+") ? "phone" : "social", value } });
    ids.push(org.id);
  }
  console.log(JSON.stringify(ids));
  await prisma.$disconnect();
})();
