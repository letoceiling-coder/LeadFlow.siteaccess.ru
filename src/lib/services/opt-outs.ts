import "server-only";
import { prisma } from "../db";
import { optOutSecret } from "../crypto";
import { OPT_OUT_STOP, readOptOut } from "../domain/offer";
import { audit, moveLead } from "./common";

export function appBaseUrl() {
  return (process.env.APP_URL || "https://leadflow.siteaccess.ru").replace(/\/$/, "");
}

export async function isOptedOut(tenantId: string, organizationId: string) {
  const row = await prisma.optOut.findUnique({ where: { organizationId } });
  return Boolean(row && row.tenantId === tenantId);
}

export async function listOptOuts(tenantId: string) {
  const rows = await prisma.optOut.findMany({
    where: { tenantId },
    include: { organization: { select: { id: true, name: true, city: true, category: true, isDemo: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows
    .filter((row) => !row.organization.isDemo)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      organizationId: row.organization.id,
      name: row.organization.name,
      city: row.organization.city,
      category: row.organization.category,
      source: row.source,
    }));
}

export async function recordOptOut(token: string) {
  const payload = readOptOut(token, optOutSecret());
  if (!payload) return { ok: false as const };
  const organization = await prisma.organization.findFirst({ where: { id: payload.organizationId, tenantId: payload.tenantId } });
  if (!organization) return { ok: false as const };
  const existing = await prisma.optOut.findUnique({ where: { organizationId: organization.id } });
  if (existing) return { ok: true as const, already: true, name: organization.name };
  await prisma.optOut.create({
    data: { tenantId: payload.tenantId, organizationId: organization.id, messageId: payload.messageId, source: "link" },
  });
  await moveLead(payload.tenantId, organization.id, "do_not_contact");
  await audit({
    tenantId: payload.tenantId,
    action: "offer.opt_out",
    entityType: "organization",
    entityId: organization.id,
    meta: { messageId: payload.messageId },
  });
  return { ok: true as const, already: false, name: organization.name };
}

export { OPT_OUT_STOP };
