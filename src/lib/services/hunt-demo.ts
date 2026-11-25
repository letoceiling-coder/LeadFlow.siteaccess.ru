import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { requireReady } from "../integrations/config";
import { StudioClient } from "../integrations/studio";
import { enqueueJob } from "../jobs/queue";
import { scenarioOf } from "../domain/scenarios";
import { demoMessage } from "../domain/demo-text";
import type { ObservationCard } from "../domain/qualify";
import { activity, audit } from "./common";
import { createSite, freshPreview, replyToAgent } from "./sites";
import { proposalUrl } from "./proposals";
import { queueSheet } from "./sheets";

/**
 * Демо-сайт прямо из карточки охоты: собрать в Studio по фактам лида → поправить словами → опубликовать по кнопке →
 * готовый текст клиенту со ссылкой на демо и КП. Публикация — только по явному нажатию (README: демо непубличное без подтверждения).
 */

const BUSY = ["queued", "building", "qa_running", "publish_requested"];

function studio(integration: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  return new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey);
}

async function outreachOf(tenantId: string, id: string) {
  const row = await prisma.outreach.findFirst({ where: { id, tenantId }, include: { organization: { select: { id: true, name: true, city: true, optOut: { select: { id: true } } } } } });
  if (!row) throw new ApiError(404, "Карточка не найдена", "not_found");
  return row;
}

async function latestSite(tenantId: string, organizationId: string) {
  return prisma.siteProject.findFirst({
    where: { tenantId, organizationId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

type SiteRow = NonNullable<Awaited<ReturnType<typeof latestSite>>>;

/** Состояние демо для карточки: этап, вопрос агента, публичная ссылка и готовый текст клиенту. */
export function demoView(site: SiteRow | null, outreach: { proposalToken: string | null; organization: { name: string } }) {
  if (!site) return null;
  const run = site.runs[0] ?? null;
  const meta = run?.replyMeta && typeof run.replyMeta === "object" ? (run.replyMeta as { kind?: string }) : null;
  const published = Boolean(site.publicUrl && site.visibility === "public");
  // Правка после публикации: на публичной ссылке старая версия, пока не опубликуют снова.
  const stale = published && site.status !== "published" && site.status !== "publish_requested";
  const kp = outreach.proposalToken ? proposalUrl(outreach.proposalToken) : null;
  return {
    siteId: site.id,
    status: site.status,
    busy: BUSY.includes(site.status),
    error: site.error,
    question: site.status === "waiting_user" ? (run?.replyText ?? "Агент ждёт уточнения.") : null,
    questionKind: site.status === "waiting_user" ? (meta?.kind ?? null) : null,
    lastReply: run?.replyText ? run.replyText.slice(0, 600) : null,
    lastPrompt: run?.prompt && run.prompt !== site.brief ? run.prompt.slice(0, 300) : null,
    publicUrl: published ? site.publicUrl : null,
    stale,
    message: published && site.publicUrl ? demoMessage({ name: outreach.organization.name, demoUrl: site.publicUrl, proposalUrl: kp }) : null,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

export async function getDemo(tenantId: string, outreachId: string) {
  const row = await outreachOf(tenantId, outreachId);
  return demoView(await latestSite(tenantId, row.organizationId), row);
}

/** Пожелания агенту из карточки охоты: что продаём по нише и какие боли видели у бизнеса. */
function wishesFor(segment: string | null, card: ObservationCard | null, extra?: string) {
  const scenario = scenarioOf(segment);
  const lines: string[] = [];
  if (scenario) {
    lines.push(`Что показываем владельцу: ${scenario.product}. Главный экран демо — ${scenario.demo.toLowerCase()}.`);
    lines.push(`Ключевые функции: ${scenario.features.join("; ")}.`);
  }
  if (card?.chaos.length) lines.push(`Сейчас у бизнеса неудобно: ${card.chaos.map((item) => item.text).join("; ")}. Покажи, как сайт это решает.`);
  if (card?.money.length) lines.push(`Подтверждено о бизнесе: ${card.money.map((item) => item.text).join("; ")}.`);
  if (extra?.trim()) lines.push(`Пожелания менеджера: ${extra.trim()}`);
  return lines.join("\n").slice(0, 3000) || undefined;
}

export const demoStartSchema = z.object({ wishes: z.string().trim().max(1000).optional() });

export async function startDemo(tenantId: string, userId: string, outreachId: string, input: z.infer<typeof demoStartSchema>) {
  const row = await outreachOf(tenantId, outreachId);
  if (row.organization.optOut) throw new ApiError(409, "Организация отказалась от сообщений — демо не собираем.", "do_not_contact");
  const scenario = scenarioOf(row.segment);
  const result = await createSite(tenantId, userId, {
    organizationId: row.organizationId,
    siteType: "landing",
    language: "ru",
    pages: scenario ? ["Главная", scenario.demo, "Контакты"] : [],
    wishes: wishesFor(row.segment, row.card as unknown as ObservationCard | null, input.wishes),
    // Нажатие кнопки в карточке и есть подтверждение траты квоты Studio.
    confirm: true,
  });
  if (!result.existing) await activity({ tenantId, organizationId: row.organizationId, actorId: userId, type: "demo.start", message: "Запущена сборка демо-сайта в Studio" });
  return getDemo(tenantId, outreachId);
}

export const demoEditSchema = z.object({ text: z.string().trim().min(3).max(2000) });

/** Ответ на вопрос агента или правка готового демо — одно и то же сообщение агенту Studio. */
export async function editDemo(tenantId: string, userId: string, outreachId: string, text: string) {
  const row = await outreachOf(tenantId, outreachId);
  const site = await latestSite(tenantId, row.organizationId);
  if (!site) throw new ApiError(409, "Демо ещё не собирали.", "no_demo");
  if (BUSY.includes(site.status)) throw new ApiError(409, "Агент ещё работает — дождитесь окончания сборки.", "busy");
  await replyToAgent(tenantId, userId, site.id, text);
  await activity({ tenantId, organizationId: row.organizationId, actorId: userId, type: "demo.edit", message: `Правка демо: ${text.slice(0, 200)}` });
  return getDemo(tenantId, outreachId);
}

/** Публикация по кнопке. Ждём до ~45 с; если сборка дольше — дособирает обработчик, ссылка появится в карточке. */
export async function publishDemo(tenantId: string, userId: string, outreachId: string) {
  const row = await outreachOf(tenantId, outreachId);
  const site = await latestSite(tenantId, row.organizationId);
  if (!site?.studioProjectId) throw new ApiError(409, "Демо ещё не собрано.", "no_demo");
  if (BUSY.includes(site.status)) throw new ApiError(409, "Агент ещё работает — опубликовать можно после сборки.", "busy");
  if (site.status === "waiting_user") throw new ApiError(409, "Агент ждёт ответа на вопрос — ответьте, потом публикуйте.", "waiting_user");
  if (site.status === "failed") throw new ApiError(409, "Последняя сборка не удалась — напишите правку или пересоберите демо.", "failed");
  const integration = await requireReady(tenantId, "studio", "Публикация демо");
  if (integration.scopes.length && !integration.scopes.includes("publish")) throw new ApiError(403, "У ключа Studio нет права publish.", "studio_scope");
  const client = studio(integration);
  const started = (await client.publish(site.studioProjectId, "public")).body as { state?: string; url?: string; error?: string };
  let state = started.state || "building";
  let url = started.url || "";
  const begun = Date.now();
  while (state === "building" && Date.now() - begun < 45000) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = (await client.publishStatus(site.studioProjectId)).body as { state?: string; url?: string; error?: string };
    state = status.state || state;
    url = status.url || url;
    if (state === "failed") throw new ApiError(502, status.error || "Публикация сайта не удалась.", "publish_failed");
  }
  await prisma.siteProject.update({
    where: { id: site.id },
    data: { publicUrl: url || site.publicUrl, visibility: "public", status: state === "published" ? "published" : "publish_requested", error: null },
  });
  if (state !== "published") await enqueueJob({ tenantId, type: "site.publish", payload: { siteProjectId: site.id }, idempotencyKey: `publish:${site.id}:${Date.now()}` });
  await audit({ tenantId, actorId: userId, action: "site.publish", entityType: "site", entityId: site.id, meta: { visibility: "public", from: "hunt" } });
  await activity({ tenantId, organizationId: row.organizationId, actorId: userId, type: "demo.published", message: `Демо опубликовано${url ? `: ${url}` : ""}` });
  await queueSheet(tenantId, "outreach", outreachId);
  return getDemo(tenantId, outreachId);
}

/** Ссылка превью для менеджера (живёт 2 минуты) — посмотреть до публикации. */
export async function previewDemo(tenantId: string, outreachId: string) {
  const row = await outreachOf(tenantId, outreachId);
  const site = await latestSite(tenantId, row.organizationId);
  if (!site) throw new ApiError(409, "Демо ещё не собирали.", "no_demo");
  return freshPreview(tenantId, site.id);
}

/** Пересобрать с нуля: старый проект помечается отменённым, новый собирается по свежим фактам. */
export async function rebuildDemo(tenantId: string, userId: string, outreachId: string, input: z.infer<typeof demoStartSchema>) {
  const row = await outreachOf(tenantId, outreachId);
  const site = await latestSite(tenantId, row.organizationId);
  if (site && BUSY.includes(site.status)) throw new ApiError(409, "Агент ещё работает — дождитесь окончания.", "busy");
  if (site) await prisma.siteProject.update({ where: { id: site.id }, data: { status: "cancelled" } });
  return startDemo(tenantId, userId, outreachId, input);
}
