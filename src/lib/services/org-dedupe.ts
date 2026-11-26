import "server-only";
import { domainToUnicode } from "node:url";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { dedupeKeys, nameProbe, phoneTail, type DedupeKeys, type DedupeMatch } from "../domain/dedupe";
import { siteDomain } from "../domain/telegram-facts";

/**
 * Найти уже существующую карточку той же организации (любой источник: карты, Telegram, ручная).
 * Порядок — от самого надёжного ключа: @username Telegram → домен сайта → телефон → название+город.
 */
export async function findDuplicate(tenantId: string, keys: DedupeKeys): Promise<{ organizationId: string; match: DedupeMatch } | null> {
  for (const username of keys.usernames) {
    const own = await prisma.organization.findFirst({ where: { tenantId, source: "telegram", externalId: `tg:${username}` }, select: { id: true } });
    if (own) return { organizationId: own.id, match: { by: "telegram", value: username } };
    const contacts = await prisma.organizationContact.findMany({
      where: {
        tenantId,
        organization: { isDemo: false },
        OR: [
          { type: "telegram", value: { equals: `@${username}`, mode: "insensitive" } },
          { value: { contains: `t.me/${username}`, mode: "insensitive" } },
          { value: { contains: `telegram.me/${username}`, mode: "insensitive" } },
        ],
      },
      select: { organizationId: true, value: true },
      take: 20,
    });
    // «t.me/fond» не должен совпасть с «t.me/fond_help»: проверяем ник целиком.
    const exact = new RegExp(`(^@|/)${username}(?![a-z0-9_])`, "i");
    const contact = contacts.find((item) => exact.test(item.value));
    if (contact) return { organizationId: contact.organizationId, match: { by: "telegram", value: username } };
  }
  for (const domain of keys.domains) {
    const rows = await prisma.organization.findMany({
      // Сайт мог быть записан и как «фонд.рф», и как punycode — ищем обе формы, сверяем точно ниже.
      where: { tenantId, isDemo: false, OR: [...new Set([domain, domainToUnicode(domain)])].filter(Boolean).map((form) => ({ website: { contains: form, mode: "insensitive" as const } })) },
      select: { id: true, website: true },
      take: 10,
    });
    const hit = rows.find((row) => siteDomain(row.website) === domain);
    if (hit) return { organizationId: hit.id, match: { by: "domain", value: domain } };
  }
  const tails = keys.phones.map(phoneTail).filter((tail): tail is string => Boolean(tail));
  if (tails.length) {
    const rows = await prisma.$queryRaw<{ organizationId: string }[]>(Prisma.sql`
      SELECT c."organizationId" FROM "OrganizationContact" c
      JOIN "Organization" o ON o."id" = c."organizationId"
      WHERE c."tenantId" = ${tenantId} AND c."type" = 'phone' AND o."isDemo" = false
        AND right(regexp_replace(c."value", '\\D', '', 'g'), 10) = ANY(${tails})
      LIMIT 1`);
    if (rows[0]) return { organizationId: rows[0].organizationId, match: { by: "phone", value: tails[0] } };
  }
  if (keys.nameCity) {
    const [name, city] = keys.nameCity.split("|");
    const probe = nameProbe(name);
    if (probe) {
      const rows = await prisma.organization.findMany({
        where: { tenantId, isDemo: false, name: { contains: probe, mode: "insensitive" }, city: { not: null } },
        select: { id: true, name: true, city: true },
        take: 30,
      });
      const hit = rows.find((row) => dedupeKeys({ name: row.name, city: row.city }).nameCity === `${name}|${city}`);
      if (hit) return { organizationId: hit.id, match: { by: "name", value: keys.nameCity } };
    }
  }
  return null;
}
