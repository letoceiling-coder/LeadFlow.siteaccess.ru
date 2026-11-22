import "server-only";
import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import { ApiError, safeLog } from "../errors";
import { isPublicHttpUrl } from "../domain/website";
import { DEFAULT_API_BASE, type ProviderId } from "./catalog";

export type ResolvedIntegration = {
  provider: ProviderId;
  configured: boolean;
  verified: boolean;
  status: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  lastCheckedAt: string | null;
  lastError: string | null;
  scopes: string[];
};

function envSecrets(provider: ProviderId): Record<string, string> {
  const pick = (...pairs: [string, string | undefined][]) => {
    const result: Record<string, string> = {};
    for (const [key, value] of pairs) if (value) result[key] = value;
    return result;
  };
  if (provider === "parser") return pick(["apiKey", process.env.PARSER_API_KEY]);
  if (provider === "studio") return pick(["apiKey", process.env.STUDIO_API_KEY]);
  if (provider === "openrouter") return pick(["apiKey", process.env.OPENROUTER_API_KEY]);
  if (provider === "email") {
    return pick(
      ["host", process.env.SMTP_HOST],
      ["port", process.env.SMTP_PORT],
      ["user", process.env.SMTP_USER],
      ["password", process.env.SMTP_PASSWORD],
      ["from", process.env.SMTP_FROM],
    );
  }
  if (provider === "telegram") return pick(["botToken", process.env.TELEGRAM_BOT_TOKEN], ["chatId", process.env.TELEGRAM_CHAT_ID]);
  if (provider === "whatsapp") return pick(["token", process.env.WHATSAPP_TOKEN], ["phoneNumberId", process.env.WHATSAPP_PHONE_NUMBER_ID]);
  if (provider === "sms") return pick(["apiId", process.env.SMS_API_ID], ["provider", process.env.SMS_PROVIDER]);
  return pick(
    ["endpoint", process.env.STORAGE_ENDPOINT],
    ["bucket", process.env.STORAGE_BUCKET],
    ["accessKey", process.env.STORAGE_ACCESS_KEY],
    ["secretKey", process.env.STORAGE_SECRET_KEY],
    ["region", process.env.STORAGE_REGION],
  );
}

function envConfig(provider: ProviderId): Record<string, unknown> {
  const fallback = DEFAULT_API_BASE[provider];
  if (!fallback) return {};
  const fromEnv =
    provider === "parser" ? process.env.PARSER_API_BASE_URL : provider === "studio" ? process.env.STUDIO_API_BASE_URL : process.env.OPENROUTER_BASE_URL;
  return { baseUrl: fromEnv || fallback };
}

function hasMinimum(provider: ProviderId, secrets: Record<string, string>, config: Record<string, unknown>): boolean {
  if (provider === "parser" || provider === "studio" || provider === "openrouter") return Boolean(secrets.apiKey);
  if (provider === "email") return Boolean(secrets.host && secrets.from);
  if (provider === "telegram") return Boolean(secrets.botToken);
  if (provider === "whatsapp") return Boolean(secrets.token && secrets.phoneNumberId);
  if (provider === "sms") return secrets.provider === "smsru" && Boolean(secrets.apiId);
  return Boolean(secrets.endpoint && secrets.bucket && secrets.accessKey && secrets.secretKey && config);
}

export function assertPublicBase(url: string, label: string) {
  const checked = isPublicHttpUrl(url);
  if (!checked.ok) throw new ApiError(400, `${label}: ${checked.reason}`, "bad_base_url");
  return checked.url.toString().replace(/\/$/, "");
}

export async function resolveIntegration(tenantId: string, provider: ProviderId): Promise<ResolvedIntegration> {
  const row = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  const storedConfig = { ...((row?.config as Record<string, unknown> | undefined) ?? {}) };
  delete storedConfig.baseUrl;
  const config = { ...storedConfig, ...envConfig(provider) };
  let stored: Record<string, string> = {};
  if (row?.secretEnc) {
    try {
      stored = JSON.parse(decryptSecret(row.secretEnc)) as Record<string, string>;
    } catch (error) {
      safeLog("integration.decrypt", error);
      throw new ApiError(500, "Не удалось прочитать сохранённый секрет. Проверьте ENCRYPTION_KEY.", "secret_unreadable");
    }
  }
  const secrets = { ...envSecrets(provider), ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value)) };
  if (typeof config.baseUrl === "string") config.baseUrl = assertPublicBase(config.baseUrl, provider);
  const configured = hasMinimum(provider, secrets, config);
  return {
    provider,
    configured,
    verified: row?.status === "connected",
    status: !configured ? "not_configured" : row?.status || "unverified",
    config,
    secrets,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    scopes: row?.scopes ?? [],
  };
}

export async function requireReady(tenantId: string, provider: ProviderId, purpose: string) {
  const integration = await resolveIntegration(tenantId, provider);
  if (!integration.configured) {
    throw new ApiError(422, `${purpose}: интеграция «${provider}» не настроена`, "integration_not_configured", "Откройте раздел «Интеграции» и сохраните ключ.");
  }
  if (integration.status !== "connected") {
    throw new ApiError(422, `${purpose}: подключение ещё не проверено`, "integration_unverified", "Нажмите «Проверить подключение» в разделе «Интеграции».");
  }
  return integration;
}
