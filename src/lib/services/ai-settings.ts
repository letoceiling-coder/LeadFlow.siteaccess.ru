import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { resolveIntegration } from "../integrations/config";
import { DEFAULT_OPENROUTER_PROXY } from "../integrations/catalog";
import { validProxy } from "../integrations/openrouter";
import { checkIntegration, saveIntegration } from "./integrations";
import { enqueueQualify } from "./hunt";
import { logEvent } from "../log";

/** AI-скоринг в админке: какой прокси действует (без логина и пароля), статус, и кнопка «Обновить». */

function proxyHost(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port}`;
  } catch {
    return null;
  }
}

export async function aiStatus(tenantId: string) {
  const integration = await resolveIntegration(tenantId, "openrouter");
  const own = integration.secrets.proxyUrl?.trim();
  const env = process.env.OPENROUTER_PROXY_URL?.trim();
  const source = own ? (own === "direct" ? "direct" : "admin") : env ? (env === "direct" ? "direct" : "env") : "default";
  const active = own ? (own === "direct" ? undefined : own) : env ? (env === "direct" ? undefined : env) : DEFAULT_OPENROUTER_PROXY;
  const pending = await prisma.outreach.count({ where: { tenantId, status: "new", cardStatus: { in: ["no_fact", "failed"] } } });
  return {
    configured: integration.configured,
    status: integration.status,
    lastError: integration.lastError,
    lastCheckedAt: integration.lastCheckedAt,
    proxy: { source, host: proxyHost(active) },
    hasKey: Boolean(integration.secrets.apiKey),
    pendingRescore: pending,
  };
}

export const aiUpdateSchema = z.object({
  proxyUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(300).optional(),
  rescore: z.boolean().optional().default(true),
});

/** «Обновить»: сохранить → проверить связь → пересчитать карточки, которые оценивались без AI. */
export async function updateAi(tenantId: string, actorId: string, input: z.infer<typeof aiUpdateSchema>) {
  const secrets: Record<string, string> = {};
  if (input.proxyUrl) {
    const proxy = validProxy(input.proxyUrl);
    if (!proxy) throw new ApiError(400, "Прокси в формате http://логин:пароль@хост:порт (или http://хост:порт). Напишите direct, чтобы ходить без прокси.", "bad_proxy");
    secrets.proxyUrl = proxy;
  }
  if (input.apiKey) {
    if (!/^sk-or-[A-Za-z0-9_-]{20,}$/.test(input.apiKey)) throw new ApiError(400, "Ключ OpenRouter начинается с sk-or-", "bad_key");
    secrets.apiKey = input.apiKey;
  }
  if (Object.keys(secrets).length) await saveIntegration(tenantId, actorId, "openrouter", undefined, secrets);
  let detail: string;
  try {
    const result = await checkIntegration(tenantId, actorId, "openrouter");
    detail = result.detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Проверка не прошла";
    logEvent("ai.check_failed", { tenant: tenantId, error: message }, "warn");
    throw new ApiError(502, `Связи с OpenRouter нет: ${message}`, "openrouter_unreachable");
  }
  let rescored = 0;
  if (input.rescore) {
    const rows = await prisma.outreach.findMany({ where: { tenantId, status: "new", cardStatus: { in: ["no_fact", "failed"] } }, select: { organizationId: true }, take: 500 });
    if (rows.length) rescored = (await enqueueQualify(tenantId, actorId, rows.map((row) => row.organizationId), true)).queued;
  }
  logEvent("ai.updated", { tenant: tenantId, rescored });
  return { ok: true, detail, rescored, status: await aiStatus(tenantId) };
}
