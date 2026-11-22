import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { encryptSecret, decryptSecret } from "../crypto";
import { ApiError, safeLog } from "../errors";
import { INTEGRATION_CATALOG, type ProviderId } from "../integrations/catalog";
import { resolveIntegration } from "../integrations/config";
import { testIntegration } from "../integrations/channels";
import { audit } from "./common";

const SECRET_KEYS = new Set(["apiKey", "password", "botToken", "token", "apiId", "accessKey", "secretKey"]);

export async function listIntegrations(tenantId: string) {
  const rows = [];
  for (const item of INTEGRATION_CATALOG) {
    const resolved = await resolveIntegration(tenantId, item.id);
    const config = Object.fromEntries(Object.entries(resolved.config).filter(([key]) => !SECRET_KEYS.has(key)));
    rows.push({
      ...item,
      status: resolved.status,
      configured: resolved.configured,
      verified: resolved.verified,
      lastCheckedAt: resolved.lastCheckedAt,
      lastError: resolved.lastError,
      scopes: resolved.scopes,
      config,
    });
  }
  return rows;
}

export async function saveIntegration(tenantId: string, userId: string, provider: ProviderId, config: Record<string, unknown> | undefined, secrets: Record<string, string> | undefined) {
  const current = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  let stored: Record<string, string> = {};
  if (current?.secretEnc) {
    try {
      stored = JSON.parse(decryptSecret(current.secretEnc)) as Record<string, string>;
    } catch (error) {
      safeLog("integration.save", error);
      throw new ApiError(500, "Старый секрет не читается. Проверьте ENCRYPTION_KEY.", "secret_unreadable");
    }
  }
  const nextSecrets = { ...stored };
  for (const [key, value] of Object.entries(secrets ?? {})) {
    if (!value) continue;
    nextSecrets[key] = value;
  }
  const secretEnc = Object.values(nextSecrets).some(Boolean) ? encryptSecret(JSON.stringify(nextSecrets)) : null;
  const merged = { ...((current?.config as Record<string, unknown> | undefined) ?? {}), ...(config ?? {}) };
  delete merged.baseUrl;
  const safeConfig = Object.fromEntries(Object.entries(merged).filter(([key]) => !SECRET_KEYS.has(key)));
  const row = await prisma.integration.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    update: { config: safeConfig as Prisma.InputJsonValue, secretEnc, status: "unverified", lastError: null },
    create: { tenantId, provider, config: safeConfig as Prisma.InputJsonValue, secretEnc, status: "unverified" },
  });
  await audit({ tenantId, actorId: userId, action: "integration.save", entityType: "integration", entityId: provider });
  return { id: row.id, status: row.status };
}

export async function checkIntegration(tenantId: string, userId: string, provider: ProviderId) {
  const resolved = await resolveIntegration(tenantId, provider);
  try {
    const result = await testIntegration(resolved);
    await prisma.integration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      update: { status: "connected", lastCheckedAt: new Date(), lastError: null, scopes: result.scopes },
      create: { tenantId, provider, status: "connected", config: {}, lastCheckedAt: new Date(), scopes: result.scopes },
    });
    await audit({ tenantId, actorId: userId, action: "integration.test", entityType: "integration", entityId: provider, meta: { ok: true } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Проверка не пройдена";
    await prisma.integration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      update: { status: resolved.configured ? "error" : "not_configured", lastCheckedAt: new Date(), lastError: message },
      create: { tenantId, provider, status: "error", config: {}, lastCheckedAt: new Date(), lastError: message },
    });
    throw error;
  }
}

export async function clearIntegration(tenantId: string, userId: string, provider: ProviderId) {
  await prisma.integration.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    update: { secretEnc: null, status: "not_configured", lastError: null, scopes: [] },
    create: { tenantId, provider, status: "not_configured", config: {} },
  });
  await audit({ tenantId, actorId: userId, action: "integration.clear", entityType: "integration", entityId: provider });
}
