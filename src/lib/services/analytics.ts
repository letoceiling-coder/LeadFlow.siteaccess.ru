import "server-only";
import { prisma } from "../db";

export async function dashboard(tenantId: string, includeDemo = false) {
  const where = { tenantId, ...(includeDemo ? {} : { isDemo: false }) };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    total,
    recent,
    noWebsite,
    withPhone,
    qualified,
    analyses,
    sites,
    readySites,
    sent,
    replies,
    activeDeals,
    wonDeals,
    searches,
    errors,
    activities,
  ] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.count({ where: { ...where, createdAt: { gte: since } } }),
    prisma.organization.count({ where: { ...where, websiteStatus: "NO_WEBSITE" } }),
    prisma.organization.count({ where: { ...where, contacts: { some: { type: "phone" } } } }),
    prisma.lead.count({ where: { tenantId, organization: where, stage: { key: { in: ["qualified", "analyzed", "demo_ready", "ready_to_contact"] } } } }),
    prisma.analysisReport.count({ where: { tenantId, source: { not: "demo" } } }),
    prisma.siteProject.count({ where: { tenantId, organization: where } }),
    prisma.siteProject.count({ where: { tenantId, organization: where, status: { in: ["qa_passed", "approved", "published", "preview_ready"] } } }),
    prisma.message.count({ where: { tenantId, status: { in: ["sent", "sent_test"] } } }),
    prisma.message.count({ where: { tenantId, direction: "inbound" } }),
    prisma.deal.count({ where: { tenantId, status: "open" } }),
    prisma.deal.count({ where: { tenantId, status: "won" } }),
    prisma.parserTask.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.parserTask.findMany({ where: { tenantId, status: "failed" }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.activity.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { id: "default" } });
  return {
    cards: { total, recent, noWebsite, withPhone, qualified, analyses, sites, readySites, sent, replies, activeDeals, wonDeals },
    searches,
    errors,
    activities,
    workerOnline: Boolean(heartbeat && Date.now() - heartbeat.seenAt.getTime() < 30000),
  };
}

function asCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "_all" in value && typeof value._all === "number") return value._all;
  return 0;
}

export async function analytics(tenantId: string, params: URLSearchParams) {
  const from = params.get("from") ? new Date(params.get("from")!) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const organizationWhere = {
    tenantId,
    isDemo: false,
    createdAt: { gte: from, lte: to },
    ...(params.get("city") ? { city: params.get("city")! } : {}),
    ...(params.get("category") ? { category: params.get("category")! } : {}),
    ...(params.get("source") ? { source: params.get("source")! } : {}),
    ...(params.get("assignee") ? { assigneeId: params.get("assignee")! } : {}),
  };
  const [organizations, byCity, byCategory, stages, costs, messages, deals, sites, qa] = await Promise.all([
    prisma.organization.count({ where: organizationWhere }),
    prisma.organization.groupBy({ by: ["city"], where: organizationWhere, _count: { _all: true } }),
    prisma.organization.groupBy({ by: ["category"], where: organizationWhere, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["stageId"], where: { tenantId, organization: { isDemo: false } }, _count: true }),
    prisma.costRecord.findMany({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
    prisma.message.groupBy({ by: ["channel", "status"], where: { tenantId, createdAt: { gte: from, lte: to } }, _count: true }),
    prisma.deal.findMany({ where: { tenantId, status: "won", updatedAt: { gte: from, lte: to } } }),
    prisma.siteProject.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
    prisma.siteAudit.count({ where: { tenantId, status: "completed", criticalCount: 0, createdAt: { gte: from, lte: to } } }),
  ]);
  const knownCosts = costs.filter((item) => !item.unknown && item.amountUsd != null);
  const unknownCosts = costs.filter((item) => item.unknown || item.amountUsd == null).length;
  const costSum = knownCosts.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0);
  const revenue = deals.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0);
  const stageRows = await prisma.pipelineStage.findMany({ where: { tenantId }, orderBy: { position: "asc" } });
  const stageCounts = stageRows.map((stage) => ({
    key: stage.key,
    name: stage.name,
    count: asCount(stages.find((item) => item.stageId === stage.id)?._count),
  }));
  const qualified = stageCounts.filter((item) => !["new", "review", "lost", "do_not_contact"].includes(item.key)).reduce((sum, item) => sum + item.count, 0);
  return {
    organizations,
    byCity: byCity.map((item) => ({ city: item.city ?? "не указан", count: item._count._all })).sort((a, b) => b.count - a.count).slice(0, 8),
    byCategory: byCategory.map((item) => ({ category: item.category ?? "не указана", count: item._count._all })).sort((a, b) => b.count - a.count).slice(0, 8),
    stages: stageCounts,
    sites,
    qaPassed: qa,
    messages: messages.map((item) => ({ channel: item.channel, status: item.status, _count: asCount(item._count) })),
    knownCostUsd: knownCosts.length ? costSum : null,
    unknownCostCount: unknownCosts,
    revenue: deals.length ? revenue : null,
    costPerQualified: qualified && knownCosts.length ? costSum / qualified : null,
    costPerDemo: sites && knownCosts.length ? costSum / sites : null,
    costPerSale: deals.length && knownCosts.length ? costSum / deals.length : null,
    roi: deals.length && knownCosts.length && costSum > 0 ? ((revenue - costSum) / costSum) * 100 : null,
    note: unknownCosts ? "Часть расходов неизвестна, потому что внешний сервис не вернул стоимость. Недостающие суммы не подставляются." : null,
  };
}
