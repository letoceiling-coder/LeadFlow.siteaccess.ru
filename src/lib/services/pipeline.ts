import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { segmentInfo } from "../domain/segments";
import { PIPELINE_STEPS, type PipelineStep } from "../domain/pipeline-steps";

/**
 * «Воронка»: весь путь лида по шагам — найден → проверка → написали → ответил → демо → созвон → смета → сделка.
 * Счётчики считаются с теми же фильтрами, что и список, кроме самого шага: видно, сколько осталось на каждом.
 */

export const pipelineQuerySchema = z.object({
  step: z.enum(PIPELINE_STEPS.map((item) => item.key) as [PipelineStep, ...PipelineStep[]]).optional(),
  segment: z.string().trim().max(10).optional(),
  city: z.string().trim().max(80).optional(),
  priority: z.enum(["A", "B", "C", "D"]).optional(),
  channel: z.string().trim().max(20).optional(),
  demo: z.enum(["any", "yes", "no", "published"]).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Доска: карточки сразу по всем шагам (до `limit` на колонку), а не одного шага. */
  board: z.enum(["1"]).optional(),
});

function filters(tenantId: string, input: z.infer<typeof pipelineQuerySchema>): Prisma.OutreachWhereInput {
  const and: Prisma.OutreachWhereInput[] = [{ tenantId }];
  if (input.segment) and.push({ segment: input.segment });
  if (input.priority) and.push({ priority: input.priority });
  if (input.channel) and.push({ channel: input.channel });
  if (input.city) and.push({ organization: { city: { equals: input.city, mode: "insensitive" } } });
  if (input.q) and.push({ organization: { name: { contains: input.q, mode: "insensitive" } } });
  if (input.demo === "yes") and.push({ organization: { sites: { some: { status: { not: "cancelled" } } } } });
  if (input.demo === "no") and.push({ organization: { sites: { none: { status: { not: "cancelled" } } } } });
  if (input.demo === "published") and.push({ organization: { sites: { some: { visibility: "public", publicUrl: { not: null }, status: { not: "cancelled" } } } } });
  return { AND: and };
}

export async function pipeline(tenantId: string, input: z.infer<typeof pipelineQuerySchema>) {
  const base = filters(tenantId, input);
  const grouped = await prisma.outreach.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
  const steps = PIPELINE_STEPS.map((step) => ({ key: step.key, label: step.label, hint: step.hint, count: step.statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0) }));
  const active = input.step ?? steps.find((step) => step.count > 0 && step.key !== "found" && step.key !== "lost")?.key ?? "found";
  const stepDef = PIPELINE_STEPS.find((item) => item.key === active)!;
  const now = new Date();
  const include = {
    organization: {
      select: {
        id: true,
        name: true,
        city: true,
        category: true,
        sites: { where: { status: { not: "cancelled" } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, publicUrl: true, visibility: true } },
      },
    },
    project: { select: { id: true, stage: true, amount: true } },
  } satisfies Prisma.OutreachInclude;
  // Сначала то, что горит: просроченный шаг, потом по приоритету и баллам.
  const orderBy: Prisma.OutreachOrderByWithRelationInput[] = [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { priority: "asc" }, { score: "desc" }];
  const load = (statuses: readonly string[], take: number) => prisma.outreach.findMany({ where: { AND: [base, { status: { in: [...statuses] } }] }, include, orderBy, take });
  type Loaded = Awaited<ReturnType<typeof load>>[number];
  const toItem = (row: Loaded) => {
    const site = row.organization.sites[0] ?? null;
    return {
      id: row.id,
      organization: { id: row.organization.id, name: row.organization.name, city: row.organization.city, category: row.organization.category },
      segment: row.segment,
      segmentLabel: segmentInfo(row.segment)?.label ?? null,
      priority: row.priority,
      score: row.score,
      status: row.status,
      channel: row.channel,
      sentAt: row.sentAt,
      repliedAt: row.repliedAt,
      nextAt: row.nextFollowUpAt,
      overdue: Boolean(row.nextFollowUpAt && row.nextFollowUpAt <= now),
      rejectReason: row.rejectReason,
      demo: site ? { status: site.status, url: site.visibility === "public" ? site.publicUrl : null } : null,
      proposal: Boolean(row.proposalToken),
      project: row.project ? { id: row.project.id, stage: row.project.stage, amount: row.project.amount } : null,
      updatedAt: row.updatedAt,
    };
  };
  const rows = input.board ? [] : await load(stepDef.statuses, input.limit ?? 100);
  const columns = input.board
    ? await Promise.all(PIPELINE_STEPS.map(async (step) => ({ key: step.key, items: (await load(step.statuses, input.limit ?? 30)).map(toItem) })))
    : null;
  const [segments, cities] = await Promise.all([
    prisma.outreach.groupBy({ by: ["segment"], where: { tenantId }, _count: { _all: true } }),
    prisma.organization.groupBy({ by: ["city"], where: { tenantId, outreach: { isNot: null }, city: { not: null } }, _count: { _all: true }, orderBy: { _count: { city: "desc" } }, take: 30 }),
  ]);
  return {
    step: active,
    steps,
    items: rows.map(toItem),
    columns,
    filters: {
      segments: segments.filter((row) => row.segment).map((row) => ({ id: row.segment!, label: segmentInfo(row.segment)?.label ?? row.segment!, count: row._count._all })),
      cities: cities.map((row) => ({ city: row.city!, count: row._count._all })),
    },
  };
}
