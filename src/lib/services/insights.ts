import "server-only";
import { prisma } from "../db";
import { segmentInfo } from "../domain/segments";
import type { ObservationCard } from "../domain/qualify";

/**
 * Память охоты: выводы из собственной истории, без AI.
 * Какие поиски дают готовые карточки, какие ниши и каналы отвечают, почему отклоняем, какие крючки сработали.
 */

type Yield = { key: string; city: string; category: string; runs: number; received: number; ready: number; review: number; incomplete: number; withReviews: number; lastAt: Date; maxResults: number };

function norm(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

export async function insights(tenantId: string) {
  const tasks = await prisma.parserTask.findMany({ where: { tenantId, status: "completed" }, orderBy: { createdAt: "desc" }, take: 200, select: { input: true, resultSummary: true, organizationCount: true, createdAt: true } });
  const map = new Map<string, Yield>();
  const allIds = new Set<string>();
  const perTask = tasks.map((task) => {
    const input = (task.input ?? {}) as { city?: string; category?: string; maxResults?: number };
    const ids = Array.isArray((task.resultSummary as { orgIds?: string[] } | null)?.orgIds) ? ((task.resultSummary as { orgIds: string[] }).orgIds) : [];
    ids.forEach((id) => allIds.add(id));
    return { city: input.city ?? "", category: input.category ?? "", maxResults: input.maxResults ?? 0, ids, received: task.organizationCount ?? ids.length, at: task.createdAt };
  });
  const outreach = allIds.size
    ? await prisma.outreach.findMany({ where: { tenantId, organizationId: { in: [...allIds] } }, select: { organizationId: true, cardStatus: true, priority: true, organization: { select: { reviewCount: true } } } })
    : [];
  const byOrg = new Map(outreach.map((row) => [row.organizationId, row]));
  for (const task of perTask) {
    if (!task.category) continue;
    const key = `${norm(task.category)}|${norm(task.city)}`;
    const entry = map.get(key) ?? { key, city: task.city, category: task.category, runs: 0, received: 0, ready: 0, review: 0, incomplete: 0, withReviews: 0, lastAt: task.at, maxResults: task.maxResults };
    entry.runs += 1;
    entry.received += task.received;
    for (const id of task.ids) {
      const row = byOrg.get(id);
      if (!row) continue;
      if (row.cardStatus === "ready" && ["A", "B"].includes(row.priority)) entry.ready += 1;
      if (row.cardStatus === "no_fact" && row.priority === "C") entry.review += 1;
      if (row.cardStatus === "incomplete") entry.incomplete += 1;
      if ((row.organization.reviewCount ?? 0) > 0) entry.withReviews += 1;
    }
    if (task.at > entry.lastAt) entry.lastAt = task.at;
    map.set(key, entry);
  }
  // Полезность поиска: готовые карточки весят 1, на проверку — 0,4. На 100 найденных.
  const searches = [...map.values()]
    .map((item) => ({ ...item, usefulPer100: item.received ? Math.round(((item.ready + item.review * 0.4) / item.received) * 100) : 0 }))
    .sort((a, b) => b.usefulPer100 - a.usefulPer100 || b.ready - a.ready);

  const sentRows = await prisma.outreach.findMany({ where: { tenantId, sentAt: { not: null } }, select: { segment: true, channel: true, repliedAt: true, card: true, pitch: true, status: true } });
  const group = <K extends string>(keyOf: (row: (typeof sentRows)[number]) => K | null) => {
    const acc = new Map<string, { sent: number; replied: number }>();
    for (const row of sentRows) {
      const key = keyOf(row) ?? "—";
      const item = acc.get(key) ?? { sent: 0, replied: 0 };
      item.sent += 1;
      if (row.repliedAt) item.replied += 1;
      acc.set(key, item);
    }
    return [...acc.entries()].map(([key, value]) => ({ key, ...value, rate: value.sent ? value.replied / value.sent : 0 })).sort((a, b) => b.sent - a.sent);
  };
  const bySegment = group((row) => row.segment as string | null).map((item) => ({ ...item, label: segmentInfo(item.key)?.label ?? "Без ниши" }));
  const byChannel = group((row) => row.channel as string | null);

  const hooks = sentRows
    .filter((row) => row.repliedAt)
    .map((row) => (row.card as unknown as ObservationCard | null)?.observation ?? row.pitch?.split("\n").find((line) => line.startsWith("Увидел")) ?? null)
    .filter((text): text is string => Boolean(text))
    .slice(0, 6);

  const rejected = await prisma.outreach.groupBy({ by: ["rejectReason"], where: { tenantId, status: { in: ["rejected", "lost"] }, rejectReason: { not: null } }, _count: { _all: true } });
  const facts = await prisma.activity.findMany({ where: { tenantId, type: "outreach.fact" }, select: { message: true }, take: 500, orderBy: { createdAt: "desc" } });
  const factCount = new Map<string, number>();
  for (const row of facts) {
    const text = row.message.replace(/^Подтверждён факт \([^)]+\): /, "");
    factCount.set(text, (factCount.get(text) ?? 0) + 1);
  }

  const advice: string[] = [];
  const best = searches.find((item) => item.received >= 5);
  if (best && best.usefulPer100 > 0) advice.push(`Лучше всего работает «${best.category}» в городе ${best.city}: ${best.usefulPer100} полезных на 100 найденных. Повторяйте этот запрос в соседних городах.`);
  const poor = searches.filter((item) => item.received >= 5 && item.usefulPer100 === 0);
  if (poor.length) advice.push(`Без полезных карточек: ${poor.slice(0, 3).map((item) => `«${item.category}» (${item.city})`).join(", ")}. Сформулируйте шире или смените нишу.`);
  const noReviews = searches.filter((item) => item.received >= 5 && item.withReviews === 0).length;
  if (noReviews && noReviews === searches.filter((item) => item.received >= 5).length) advice.push("Парсер не отдаёт отзывы ни в одном поиске — «деньги» видны только через AI или вашу проверку во вкладке «Проверка».");
  const topReject = rejected.sort((a, b) => b._count._all - a._count._all)[0];
  if (topReject && topReject._count._all >= 5) advice.push(`Чаще всего отклоняете по причине «${topReject.rejectReason}» (${topReject._count._all}) — уберите такие карточки на входе: смените категорию или город.`);

  return {
    searches: searches.slice(0, 12),
    bySegment,
    byChannel,
    hooks,
    rejectReasons: rejected.map((item) => ({ reason: item.rejectReason ?? "—", count: item._count._all })).sort((a, b) => b.count - a.count).slice(0, 6),
    manualFacts: [...factCount.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    advice,
  };
}
