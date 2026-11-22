import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { mergeSettings } from "../domain/settings";
import { ensureLead } from "./common";

const SAMPLES = [
  {
    name: "Демо · Клиника «Пример»",
    city: "Демо-город",
    category: "стоматология",
    address: "ул. Примерная, 1",
    phone: "+7 000 000-00-01",
    rating: 4.9,
    reviewCount: 120,
    services: ["Осмотр", "Консультация"],
    website: null,
  },
  {
    name: "Демо · Кафе «Витрина»",
    city: "Демо-город",
    category: "кафе",
    address: "ул. Примерная, 2",
    phone: "+7 000 000-00-02",
    rating: 4.4,
    reviewCount: 35,
    services: ["Завтраки"],
    website: "https://vk.com/demo_example",
  },
];

export async function enableDemo(tenantId: string) {
  const existing = await prisma.organization.count({ where: { tenantId, isDemo: true } });
  if (existing > 0) return { created: 0 };
  for (const sample of SAMPLES) {
    const organization = await prisma.organization.create({
      data: {
        tenantId,
        source: "demo",
        externalId: `demo:${sample.name}`,
        isDemo: true,
        name: sample.name,
        city: sample.city,
        category: sample.category,
        address: sample.address,
        website: sample.website,
        websiteStatus: sample.website ? "SOCIAL_ONLY" : "NO_WEBSITE",
        rating: sample.rating,
        reviewCount: sample.reviewCount,
        services: sample.services,
        processingStatus: "new",
        leadScore: sample.website ? 45 : 70,
      },
    });
    await prisma.organizationContact.create({
      data: { tenantId, organizationId: organization.id, type: "phone", value: sample.phone, source: "demo", permissionStatus: "unknown" },
    });
    await ensureLead(tenantId, organization.id);
    await prisma.analysisReport.create({
      data: {
        tenantId,
        organizationId: organization.id,
        status: "completed",
        source: "demo",
        model: null,
        promptVersion: "demo",
        confidence: 1,
        costUnknown: true,
        report: {
          summary: "Это пример отчёта, а не результат модели.",
          unknowns: ["Реальные услуги, цены и юридические данные неизвестны"],
          reasoning: [{ text: "Карточка помечена как демонстрационная", kind: "fact" }],
          sources: [{ field: "name", origin: "локальный пример" }],
          commercialPotential: null,
        } as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const settings = { ...mergeSettings(tenant.settings), demoMode: true };
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
  return { created: SAMPLES.length };
}

export async function disableDemo(tenantId: string) {
  await prisma.organization.deleteMany({ where: { tenantId, isDemo: true } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;
  const settings = { ...mergeSettings(tenant.settings), demoMode: false };
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
}
