import "server-only";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { sha256, encryptSecret } from "../crypto";
import { ApiError } from "../errors";
import { requestJson } from "../http";
import { resolveIntegration } from "../integrations/config";
import { logEvent } from "../log";
import { audit } from "./common";

/**
 * Ошибки пространства → Telegram-чат, который владелец привязал кнопкой «Привязать Telegram».
 * Чат хранится у интеграции telegram этого пространства (alertChatId), поэтому ошибки одного
 * аккаунта никогда не уходят в чат другого.
 */

type TgUpdate = { update_id: number; message?: { date: number; text?: string; chat?: { id: number; type?: string; title?: string; username?: string; first_name?: string } } };

const BIND_TTL_MS = 15 * 60 * 1000;

function tg(token: string, method: string, body?: unknown) {
  return requestJson(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 15000,
  });
}

async function readRow(tenantId: string) {
  const row = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId, provider: "telegram" } } });
  return { row, config: { ...((row?.config as Record<string, unknown> | undefined) ?? {}) } };
}

/** Секреты пишем сами (а не через saveIntegration), чтобы привязка не сбрасывала статус интеграции. */
async function writeTelegram(tenantId: string, config: Record<string, unknown>, secrets?: Record<string, string>) {
  const data: Prisma.IntegrationUncheckedUpdateInput = { config: config as Prisma.InputJsonValue };
  if (secrets) data.secretEnc = Object.values(secrets).some(Boolean) ? encryptSecret(JSON.stringify(secrets)) : null;
  await prisma.integration.upsert({
    where: { tenantId_provider: { tenantId, provider: "telegram" } },
    update: data,
    create: { tenantId, provider: "telegram", status: "unverified", config: config as Prisma.InputJsonValue, secretEnc: (data.secretEnc as string | null | undefined) ?? null },
  });
}

/** Секреты Telegram этого пространства (.env для Telegram не подмешивается — см. integrations/config). */
async function ownSecrets(tenantId: string): Promise<Record<string, string>> {
  return { ...(await resolveIntegration(tenantId, "telegram")).secrets };
}

export async function alertStatus(tenantId: string) {
  const resolved = await resolveIntegration(tenantId, "telegram");
  const { config } = await readRow(tenantId);
  return {
    hasBot: Boolean(resolved.secrets.botToken),
    botUsername: typeof config.botUsername === "string" ? config.botUsername : null,
    linked: Boolean(resolved.secrets.alertChatId),
    chatTitle: typeof config.alertChatTitle === "string" ? config.alertChatTitle : null,
    linkedAt: typeof config.alertLinkedAt === "string" ? config.alertLinkedAt : null,
    pending: typeof config.bindExpiresAt === "string" && Date.parse(config.bindExpiresAt) > Date.now(),
  };
}

/** Шаг 1: проверить бота, выдать ссылку t.me/<бот>?start=<код>. */
export async function startBinding(tenantId: string, actorId: string, botToken?: string) {
  const secrets = await ownSecrets(tenantId);
  if (botToken) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw new ApiError(400, "Токен бота выглядит как 123456789:AA… — возьмите его у @BotFather.", "bad_bot_token");
    secrets.botToken = botToken;
  }
  const token = secrets.botToken;
  if (!token) throw new ApiError(422, "Нужен бот: создайте его в @BotFather и вставьте токен.", "telegram_bot_required");
  const me = await tg(token, "getMe");
  const username = (me.body as { ok?: boolean; result?: { username?: string } })?.result?.username;
  if (!(me.body as { ok?: boolean })?.ok || !username) throw new ApiError(401, "Telegram не принял токен бота.", "telegram_unauthorized");
  const code = randomBytes(12).toString("hex");
  const { config } = await readRow(tenantId);
  await writeTelegram(
    tenantId,
    { ...config, botUsername: username, bindCodeHash: sha256(code), bindExpiresAt: new Date(Date.now() + BIND_TTL_MS).toISOString() },
    botToken ? secrets : undefined,
  );
  await audit({ tenantId, actorId, action: "telegram.bind_start", entityType: "integration", entityId: "telegram" });
  return { link: `https://t.me/${username}?start=${code}`, botUsername: username, expiresInSec: BIND_TTL_MS / 1000 };
}

/** Шаг 2: человек нажал «Start» в боте — находим /start <код> в getUpdates и запоминаем чат. */
export async function confirmBinding(tenantId: string, actorId: string) {
  const { config } = await readRow(tenantId);
  const hash = typeof config.bindCodeHash === "string" ? config.bindCodeHash : "";
  if (!hash || typeof config.bindExpiresAt !== "string" || Date.parse(config.bindExpiresAt) < Date.now()) {
    throw new ApiError(410, "Ссылка привязки истекла — нажмите «Привязать Telegram» ещё раз.", "bind_expired");
  }
  const resolved = await resolveIntegration(tenantId, "telegram");
  const token = resolved.secrets.botToken;
  if (!token) throw new ApiError(422, "Бот не задан.", "telegram_bot_required");
  const updates = await tg(token, "getUpdates", { timeout: 0, limit: 100, allowed_updates: ["message"] });
  const body = updates.body as { ok?: boolean; description?: string; result?: TgUpdate[] };
  if (!body?.ok) {
    if (updates.response.status === 409) throw new ApiError(409, "У этого бота включён webhook — для уведомлений нужен отдельный бот.", "telegram_webhook");
    throw new ApiError(502, "Telegram не отдал сообщения бота.", "telegram_updates");
  }
  const list = body.result ?? [];
  const match = list.find((item) => {
    const parts = item.message?.text?.trim().split(/\s+/) ?? [];
    return parts[0]?.startsWith("/start") && parts[1] && sha256(parts[1]) === hash;
  });
  // Подтверждаем найденное и всё, что старше 15 минут, — чужие свежие /start не трогаем.
  const staleBefore = Math.floor((Date.now() - BIND_TTL_MS) / 1000);
  const ackUpTo = Math.max(match?.update_id ?? -1, ...list.filter((item) => (item.message?.date ?? 0) < staleBefore).map((item) => item.update_id));
  if (ackUpTo >= 0) await tg(token, "getUpdates", { offset: ackUpTo + 1, timeout: 0, limit: 1 }).catch(() => undefined);
  if (!match?.message?.chat) return { linked: false };

  const chat = match.message.chat;
  const title = chat.title || (chat.username ? `@${chat.username}` : chat.first_name) || String(chat.id);
  const secrets: Record<string, string> = { ...(await ownSecrets(tenantId)), alertChatId: String(chat.id) };
  const next: Record<string, unknown> = { ...config, alertChatTitle: title, alertLinkedAt: new Date().toISOString() };
  delete next.bindCodeHash;
  delete next.bindExpiresAt;
  await writeTelegram(tenantId, next, secrets);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  await tg(token, "sendMessage", { chat_id: chat.id, text: `✅ LeadFlow: чат привязан к пространству «${tenant?.name ?? ""}». Сюда будут приходить ошибки и сбои этого аккаунта.` }).catch(() => undefined);
  await audit({ tenantId, actorId, action: "telegram.bind_done", entityType: "integration", entityId: "telegram" });
  logEvent("telegram.bound", { tenant: tenantId });
  return { linked: true, chatTitle: title };
}

export async function unbindTelegram(tenantId: string, actorId: string) {
  const { config } = await readRow(tenantId);
  const secrets = await ownSecrets(tenantId);
  delete secrets.alertChatId;
  delete config.alertChatTitle;
  delete config.alertLinkedAt;
  await writeTelegram(tenantId, config, secrets);
  await audit({ tenantId, actorId, action: "telegram.unbind", entityType: "integration", entityId: "telegram" });
}

export async function testAlert(tenantId: string) {
  const sent = await sendAlert(tenantId, "Проверка уведомлений", "Это тестовое сообщение. Ошибки поиска, парсера, AI и задач будут приходить сюда.", { force: true });
  if (!sent) throw new ApiError(422, "Telegram не привязан или бот не смог отправить сообщение.", "telegram_not_linked");
  return { ok: true };
}

// Антиспам: одинаковая ошибка — не чаще раза в 15 минут, всего не больше 30 сообщений в час на пространство.
const recent = new Map<string, number>();
const hourly = new Map<string, { start: number; count: number }>();

function allowed(tenantId: string, key: string) {
  const now = Date.now();
  if (recent.size > 5000) for (const [k, at] of recent) if (now - at > 15 * 60 * 1000) recent.delete(k);
  const last = recent.get(key);
  if (last && now - last < 15 * 60 * 1000) return false;
  const bucket = hourly.get(tenantId);
  if (!bucket || now - bucket.start > 60 * 60 * 1000) hourly.set(tenantId, { start: now, count: 1 });
  else if (bucket.count >= 30) return false;
  else bucket.count += 1;
  recent.set(key, now);
  return true;
}

function clean(text: string) {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [скрыто]")
    .replace(/(pai|lsk|sk)[-_][A-Za-z0-9_-]{8,}/g, "[ключ скрыт]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[скрыто]")
    .replace(/\/\/[^/@\s]+@/g, "//[скрыто]@")
    .slice(0, 1500);
}

/** Отправить ошибку в привязанный чат пространства. Никогда не бросает исключение. */
export async function sendAlert(tenantId: string, title: string, detail: string, options: { key?: string; force?: boolean } = {}) {
  try {
    if (!options.force && !allowed(tenantId, `${tenantId}:${options.key ?? title}:${detail.slice(0, 120)}`)) return false;
    const resolved = await resolveIntegration(tenantId, "telegram");
    const chatId = resolved.secrets.alertChatId;
    const token = resolved.secrets.botToken;
    if (!chatId || !token) return false;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const text = `⚠️ ${clean(title)}\n${clean(detail)}\n\nПространство: ${tenant?.name ?? tenantId}\n${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`;
    const result = await tg(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
    return Boolean((result.body as { ok?: boolean })?.ok);
  } catch (error) {
    logEvent("telegram.alert_failed", { tenant: tenantId, error: error instanceof Error ? error.message : String(error) }, "warn");
    return false;
  }
}
