import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { contactKinds } from "../domain/agent-filters";
import { classifyWebsite, isPublicHttpUrl } from "../domain/website";
import { computeLeadScore } from "../domain/scoring";
import { fallbackExternalId, mapParserOrganization, type MappedOrganization } from "../domain/parser-map";
import { csvCell } from "../domain/csv";
import { activity, assertAssignee, ensureLead, getSettings, moveLead } from "./common";

const SORTS = ["name", "city", "rating", "reviewCount", "createdAt", "updatedAt", "leadScore"] as const;
type OrgSort = (typeof SORTS)[number];

export async function upsertMapped(tenantId: string, mapped: MappedOrganization) {
  const externalId = mapped.externalId || fallbackExternalId(mapped.name, mapped.city, mapped.address);
  const where = { tenantId_source_externalId: { tenantId, source: mapped.source || "yandex", externalId } };
  const existing = await prisma.organization.findUnique({ where });
  const shared = {
    name: mapped.name,
    city: mapped.city,
    region: mapped.region,
    category: mapped.category,
    categories: mapped.categories,
    address: mapped.address,
    website: mapped.website,
    websiteStatus: existing?.websiteStatus === "BROKEN_WEBSITE" ? existing.websiteStatus : mapped.websiteStatus,
    rating: mapped.rating,
    reviewCount: mapped.reviewCount,
    photoCount: mapped.photoCount,
    sourceUrl: mapped.sourceUrl,
    lat: mapped.lat,
    lon: mapped.lon,
    services: mapped.services,
    features: mapped.features,
    hours: mapped.hours == null ? Prisma.JsonNull : (mapped.hours as Prisma.InputJsonValue),
    description: mapped.description,
    legalName: mapped.legalName,
    raw: mapped.raw == null ? Prisma.JsonNull : (mapped.raw as Prisma.InputJsonValue),
    parserUpdatedAt: mapped.parserUpdatedAt ? new Date(mapped.parserUpdatedAt) : new Date(),
    firstSeenAt: existing?.firstSeenAt ?? (mapped.firstSeenAt ? new Date(mapped.firstSeenAt) : new Date()),
  };
  const organization = existing
    ? await prisma.organization.update({ where: { id: existing.id }, data: shared })
    : await prisma.organization.create({
        data: {
          ...shared,
          tenantId,
          externalId,
          source: mapped.source || "yandex",
          isDemo: false,
        },
      });
  await prisma.organizationContact.deleteMany({ where: { organizationId: organization.id, source: "parser" } });
  const contacts = [
    ...mapped.phones.map((value) => ({ type: "phone", value })),
    ...mapped.emails.map((value) => ({ type: "email", value: value.toLowerCase() })),
    ...mapped.socials.map((value) => ({ type: "social", value })),
    ...(mapped.website && mapped.websiteStatus === "SOCIAL_ONLY" ? [{ type: "social", value: mapped.website }] : []),
  ];
  if (contacts.length) {
    await prisma.organizationContact.createMany({
      data: contacts.map((contact) => ({ ...contact, tenantId, organizationId: organization.id, source: "parser" })),
      skipDuplicates: true,
    });
  }
  if (!existing) {
    await ensureLead(tenantId, organization.id);
    const { emitTrigger } = await import("./automations");
    await emitTrigger(tenantId, "organization.created", {
      organizationId: organization.id,
      websiteStatus: organization.websiteStatus,
      score: organization.leadScore ?? 0,
    });
  }
  return { organization, created: !existing };
}

function listedContactKinds(contacts: { type: string; value: string }[]) {
  const kinds = new Set<string>();
  for (const contact of contacts) {
    for (const kind of contactKinds(contact.type, contact.value)) kinds.add(kind);
  }
  const specific = [...kinds].filter((kind) => kind !== "social");
  return specific.length ? specific : [...kinds];
}

export async function listOrganizations(tenantId: string, params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || 25)));
  const requested = params.get("sort");
  const sort: OrgSort = SORTS.includes(requested as OrgSort) ? (requested as OrgSort) : "createdAt";
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const where = await buildWhere(tenantId, params);
  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contacts: true,
        lead: { include: { stage: true } },
        sites: { select: { id: true, status: true }, take: 1, orderBy: { createdAt: "desc" } },
        analyses: { select: { id: true, status: true }, take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
  ]);
  const members = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.assigneeId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, name: true },
  });
  const names = new Map(members.map((member) => [member.id, member.name]));
  return {
    total,
    page,
    pageSize,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      city: row.city,
      address: row.address,
      phone: row.contacts.find((contact) => contact.type === "phone")?.value ?? null,
      email: row.contacts.find((contact) => contact.type === "email")?.value ?? null,
      contactKinds: listedContactKinds(row.contacts),
      website: row.website,
      websiteStatus: row.websiteStatus,
      rating: row.rating,
      reviewCount: row.reviewCount,
      source: row.source,
      isDemo: row.isDemo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      processingStatus: row.processingStatus,
      assigneeId: row.assigneeId,
      assigneeName: row.assigneeId ? names.get(row.assigneeId) ?? null : null,
      leadScore: row.leadScore,
      stage: row.lead?.stage.name ?? null,
      stageKey: row.lead?.stage.key ?? null,
      aiStatus: row.analyses[0]?.status ?? "none",
      hasDemo: row.sites.length > 0,
    })),
  };
}

async function buildWhere(tenantId: string, params: URLSearchParams): Promise<Prisma.OrganizationWhereInput> {
  const where: Prisma.OrganizationWhereInput = { tenantId };
  if (params.get("includeDemo") !== "true") where.isDemo = false;
  const q = params.get("q")?.trim();
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }];
  if (params.get("city")) where.city = { equals: params.get("city")!, mode: "insensitive" };
  if (params.get("category")) where.category = { equals: params.get("category")!, mode: "insensitive" };
  if (params.get("source")) where.source = params.get("source")!;
  if (params.get("hasWebsite") === "true") where.websiteStatus = "WEBSITE_EXISTS";
  if (params.get("hasWebsite") === "false") where.websiteStatus = "NO_WEBSITE";
  if (params.get("websiteStatus")) where.websiteStatus = params.get("websiteStatus")!;
  if (params.get("minRating")) where.rating = { gte: Number(params.get("minRating")) };
  if (params.get("minReviews")) where.reviewCount = { gte: Number(params.get("minReviews")) };
  if (params.get("assigneeId")) where.assigneeId = params.get("assigneeId");
  if (params.get("createdFrom") || params.get("createdTo")) {
    where.createdAt = {
      gte: params.get("createdFrom") ? new Date(params.get("createdFrom")!) : undefined,
      lte: params.get("createdTo") ? new Date(params.get("createdTo")!) : undefined,
    };
  }
  if (params.get("hasPhone") === "true") where.contacts = { some: { type: "phone" } };
  if (params.get("hasPhone") === "false") where.contacts = { none: { type: "phone" } };
  if (params.get("hasEmail") === "true") where.contacts = { some: { type: "email" } };
  if (params.get("aiStatus") === "none") where.analyses = { none: {} };
  if (params.get("aiStatus") && params.get("aiStatus") !== "none") where.analyses = { some: { status: params.get("aiStatus")! } };
  if (params.get("hasDemo") === "true") where.sites = { some: {} };
  if (params.get("hasDemo") === "false") where.sites = { none: {} };
  if (params.get("stage")) where.lead = { stage: { key: params.get("stage")! } };
  if (params.get("minScore")) where.leadScore = { gte: Number(params.get("minScore")) };
  return where;
}

export async function getOrganization(tenantId: string, id: string) {
  const organization = await prisma.organization.findFirst({
    where: { id, tenantId },
    include: {
      contacts: true,
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      tags: true,
      analyses: { orderBy: { createdAt: "desc" }, take: 5 },
      scores: { orderBy: { createdAt: "desc" }, take: 3 },
      sites: { orderBy: { createdAt: "desc" } },
      lead: { include: { stage: true, tasks: { orderBy: { dueAt: "asc" } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 40 },
      conversations: { include: { messages: { orderBy: { createdAt: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  const costs = await prisma.costRecord.findMany({ where: { tenantId, organizationId: id }, orderBy: { createdAt: "desc" }, take: 20 });
  return { organization, costs };
}

export async function updateOrganization(tenantId: string, id: string, input: { assigneeId?: string | null; processingStatus?: string; stageKey?: string }, actorId: string) {
  const organization = await prisma.organization.findFirst({ where: { id, tenantId } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  if (input.assigneeId) await assertAssignee(tenantId, input.assigneeId);
  const updated = await prisma.organization.update({
    where: { id },
    data: {
      assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId,
      processingStatus: input.processingStatus,
    },
  });
  if (input.stageKey) await moveLead(tenantId, id, input.stageKey, actorId);
  if (input.assigneeId !== undefined) {
    await activity({ tenantId, organizationId: id, actorId, type: "assign", message: input.assigneeId ? "Назначен ответственный" : "Ответственный снят" });
  }
  return updated;
}

export async function addNote(tenantId: string, organizationId: string, authorId: string, body: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  return prisma.organizationNote.create({ data: { tenantId, organizationId, authorId, body } });
}

export async function removeOrganization(tenantId: string, id: string) {
  const result = await prisma.organization.deleteMany({ where: { id, tenantId } });
  if (result.count !== 1) throw new ApiError(404, "Организация не найдена", "not_found");
}

export async function createManual(tenantId: string, input: {
  name: string;
  city?: string;
  region?: string;
  category?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  sourceUrl?: string;
}) {
  const mapped = mapParserOrganization({
    name: input.name,
    city: input.city,
    region: input.region,
    category: input.category,
    address: input.address,
    phones: input.phone ? [input.phone] : [],
    emails: input.email ? [input.email] : [],
    website: input.website,
    sourceUrl: input.sourceUrl,
    source: "manual",
    externalId: fallbackExternalId(input.name, input.city ?? null, input.address ?? null),
  });
  if (!mapped) throw new ApiError(400, "Недостаточно данных", "invalid");
  try {
    return await upsertMapped(tenantId, mapped);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "Такая организация уже есть в базе", "duplicate");
    }
    throw error;
  }
}

export async function ownedIds(tenantId: string, ids: string[]) {
  const rows = await prisma.organization.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, isDemo: true } });
  if (rows.length !== ids.length) throw new ApiError(404, "Часть организаций не найдена в этом пространстве", "not_found");
  return rows;
}

export async function scoreOrganization(tenantId: string, organizationId: string, commercialPotential: boolean | null = null) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId }, include: { contacts: true } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  const settings = await getSettings(tenantId);
  const result = computeLeadScore(
    {
      websiteStatus: organization.websiteStatus,
      hasPhone: organization.contacts.some((contact) => contact.type === "phone"),
      hasEmail: organization.contacts.some((contact) => contact.type === "email"),
      rating: organization.rating,
      reviewCount: organization.reviewCount,
      hasAddress: Boolean(organization.address),
      hasCategory: Boolean(organization.category),
      photoCount: organization.photoCount,
      services: organization.services,
      commercialPotential,
    },
    settings.scoreWeights,
  );
  await prisma.leadScore.create({
    data: {
      tenantId,
      organizationId,
      score: result.score,
      method: commercialPotential == null ? "rules" : "rules+ai",
      factors: result.factors as unknown as Prisma.InputJsonValue,
      weights: result.weights as unknown as Prisma.InputJsonValue,
      explanation: result.disclaimer,
    },
  });
  await prisma.organization.update({ where: { id: organizationId }, data: { leadScore: result.score } });
  return result;
}

export async function checkWebsite(tenantId: string, organizationId: string, actorId: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId } });
  if (!organization) throw new ApiError(404, "Организация не найдена", "not_found");
  if (!organization.website) {
    await prisma.organization.update({ where: { id: organizationId }, data: { websiteStatus: "NO_WEBSITE", websiteCheckedAt: new Date(), websiteCheckNote: "В карточке нет адреса сайта" } });
    return { status: "NO_WEBSITE", note: "В карточке нет адреса сайта" };
  }
  const initial = classifyWebsite(organization.website);
  if (initial !== "WEBSITE_EXISTS") {
    await prisma.organization.update({ where: { id: organizationId }, data: { websiteStatus: initial, websiteCheckedAt: new Date(), websiteCheckNote: "Адрес похож на соцсеть, агрегатор или не разбирается" } });
    return { status: initial, note: "HTTP-проверка не запускалась: это не похоже на собственный сайт" };
  }
  const checked = isPublicHttpUrl(organization.website);
  if (!checked.ok) throw new ApiError(400, checked.reason, "unsafe_url");
  let current = checked.url.toString();
  let status = 0;
  let note = "";
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const safe = isPublicHttpUrl(current);
      if (!safe.ok) throw new ApiError(400, "Сайт перенаправляет на внутренний адрес", "unsafe_redirect");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal });
      clearTimeout(timer);
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        current = new URL(location, current).toString();
        continue;
      }
      status = response.status;
      break;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    note = "Сайт не ответил. Это может быть временной ошибкой, поэтому статус не меняется на «сайта нет».";
    await prisma.organization.update({
      where: { id: organizationId },
      data: { websiteStatus: "UNCERTAIN", websiteCheckedAt: new Date(), websiteCheckNote: note },
    });
    await prisma.enrichmentRun.create({ data: { tenantId, organizationId, type: "website_check", status: "uncertain", error: note, finishedAt: new Date() } });
    return { status: "UNCERTAIN", note };
  }
  let websiteStatus = "WEBSITE_EXISTS";
  if (status === 404 || status === 410) {
    websiteStatus = "BROKEN_WEBSITE";
    note = `Сервер ответил ${status}. Адрес, скорее всего, не работает.`;
  } else if (status >= 500 || status === 0) {
    websiteStatus = "UNCERTAIN";
    note = `Сервер ответил ${status || "без кода"}. Временная ошибка не считается отсутствием сайта.`;
  } else {
    note = `Ответ ${status}. Сайт открывается.`;
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { websiteStatus, websiteCheckedAt: new Date(), websiteCheckNote: note } });
  await prisma.enrichmentRun.create({ data: { tenantId, organizationId, type: "website_check", status: "completed", result: { status, websiteStatus }, finishedAt: new Date() } });
  await activity({ tenantId, organizationId, actorId, type: "website_check", message: note });
  return { status: websiteStatus, note };
}

export async function exportOrganizations(tenantId: string, params: URLSearchParams) {
  const where = await buildWhere(tenantId, params);
  const total = await prisma.organization.count({ where });
  const rows = await prisma.organization.findMany({ where, take: 10000, orderBy: { createdAt: "desc" }, include: { contacts: true, lead: { include: { stage: true } } } });
  const header = ["Название", "Категория", "Город", "Адрес", "Телефон", "Email", "Сайт", "Статус сайта", "Рейтинг", "Отзывы", "Оценка", "Стадия", "Источник", "Демо"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.category,
        row.city,
        row.address,
        row.contacts.find((contact) => contact.type === "phone")?.value,
        row.contacts.find((contact) => contact.type === "email")?.value,
        row.website,
        row.websiteStatus,
        row.rating,
        row.reviewCount,
        row.leadScore,
        row.lead?.stage.name,
        row.source,
        row.isDemo ? "да" : "нет",
      ].map(csvCell).join(","),
    );
  }
  return { csv: `\uFEFF${lines.join("\n")}`, total, truncated: total > rows.length };
}

export async function filterOptions(tenantId: string) {
  const [cities, categories] = await Promise.all([
    prisma.organization.findMany({ where: { tenantId, isDemo: false, city: { not: null } }, distinct: ["city"], select: { city: true }, take: 200 }),
    prisma.organization.findMany({ where: { tenantId, isDemo: false, category: { not: null } }, distinct: ["category"], select: { category: true }, take: 200 }),
  ]);
  return {
    cities: cities.map((item) => item.city).filter(Boolean),
    categories: categories.map((item) => item.category).filter(Boolean),
  };
}

export async function globalSearch(tenantId: string, q: string) {
  const query = q.trim();
  if (query.length < 2) return { organizations: [], sites: [] };
  const [organizations, sites] = await Promise.all([
    prisma.organization.findMany({
      where: { tenantId, isDemo: false, name: { contains: query, mode: "insensitive" } },
      take: 8,
      select: { id: true, name: true, city: true, category: true },
    }),
    prisma.siteProject.findMany({
      where: { tenantId, name: { contains: query, mode: "insensitive" } },
      take: 5,
      select: { id: true, name: true, status: true },
    }),
  ]);
  return { organizations, sites };
}
