import "server-only";
import nodemailer from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { ApiError } from "../errors";
import { requestJson } from "../http";
import { logEvent } from "../log";

/**
 * Настройки всей платформы, а не отдельного пространства:
 * бот для входа через Telegram, почта для кодов входа, приём заявок.
 * Секреты хранятся зашифрованными; если в админке пусто — берём из .env.
 */

export type AccessSettings = {
  /** Принимать заявки от новых людей (почта/Telegram). Выключено — войти могут только те, у кого уже есть доступ или ссылка-приглашение. */
  allowRequests: boolean;
  /** Уведомлять администраторов в Telegram о новых заявках. */
  notifyAdmins: boolean;
  botUsername: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
};

type AccessSecrets = { botToken?: string; smtpPassword?: string };

const KEY = "access";

const DEFAULTS: AccessSettings = {
  allowRequests: true,
  notifyAdmins: true,
  botUsername: null,
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpFrom: "",
};

async function readRow() {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  const value = { ...DEFAULTS, ...((row?.value as Partial<AccessSettings> | undefined) ?? {}) };
  let secrets: AccessSecrets = {};
  if (row?.secretEnc) {
    try {
      secrets = JSON.parse(decryptSecret(row.secretEnc)) as AccessSecrets;
    } catch {
      secrets = {};
    }
  }
  return { value, secrets };
}

export async function accessSettings() {
  return (await readRow()).value;
}

/** Итоговые значения с учётом .env — то, чем реально пользуется вход. */
export async function resolvedAccess() {
  const { value, secrets } = await readRow();
  const botToken = secrets.botToken || process.env.AUTH_TELEGRAM_BOT_TOKEN || "";
  const smtp = {
    host: value.smtpHost || process.env.SMTP_HOST || "",
    port: Number(value.smtpHost ? value.smtpPort : process.env.SMTP_PORT || value.smtpPort || 587),
    user: value.smtpHost ? value.smtpUser : process.env.SMTP_USER || "",
    password: value.smtpHost ? secrets.smtpPassword || "" : process.env.SMTP_PASSWORD || "",
    from: value.smtpFrom || process.env.SMTP_FROM || value.smtpUser || process.env.SMTP_USER || "",
  };
  return { settings: value, botToken, smtp };
}

/** Что видит админка: без секретов, только «задано / не задано» и откуда. */
export async function accessSettingsView() {
  const { value, secrets } = await readRow();
  const resolved = await resolvedAccess();
  return {
    ...value,
    botTokenSet: Boolean(secrets.botToken),
    botFromEnv: !secrets.botToken && Boolean(process.env.AUTH_TELEGRAM_BOT_TOKEN),
    smtpPasswordSet: Boolean(secrets.smtpPassword),
    smtpFromEnv: !value.smtpHost && Boolean(process.env.SMTP_HOST),
    registrationLocked: process.env.ALLOW_REGISTRATION === "false",
    emailReady: Boolean(resolved.smtp.host && resolved.smtp.from),
    telegramReady: Boolean(resolved.botToken),
  };
}

export async function saveAccessSettings(patch: Partial<AccessSettings> & { botToken?: string | null; smtpPassword?: string | null }) {
  const { value, secrets } = await readRow();
  const next: AccessSettings = { ...value };
  if (typeof patch.allowRequests === "boolean") next.allowRequests = patch.allowRequests;
  if (typeof patch.notifyAdmins === "boolean") next.notifyAdmins = patch.notifyAdmins;
  if (typeof patch.smtpHost === "string") next.smtpHost = patch.smtpHost.trim();
  if (patch.smtpPort !== undefined) next.smtpPort = Number(patch.smtpPort) || 587;
  if (typeof patch.smtpUser === "string") next.smtpUser = patch.smtpUser.trim();
  if (typeof patch.smtpFrom === "string") next.smtpFrom = patch.smtpFrom.trim();
  const nextSecrets: AccessSecrets = { ...secrets };
  if (patch.botToken === null || patch.botToken === "") {
    delete nextSecrets.botToken;
    next.botUsername = null;
  } else if (typeof patch.botToken === "string") {
    const token = patch.botToken.trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new ApiError(400, "Токен бота выглядит как 123456789:AA… — возьмите его у @BotFather.", "bad_bot_token");
    const username = await botUsername(token);
    nextSecrets.botToken = token;
    next.botUsername = username;
  }
  if (patch.smtpPassword === null) delete nextSecrets.smtpPassword;
  else if (typeof patch.smtpPassword === "string" && patch.smtpPassword) nextSecrets.smtpPassword = patch.smtpPassword;
  const secretEnc = Object.values(nextSecrets).some(Boolean) ? encryptSecret(JSON.stringify(nextSecrets)) : null;
  await prisma.platformSetting.upsert({
    where: { key: KEY },
    update: { value: next as unknown as Prisma.InputJsonValue, secretEnc },
    create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, secretEnc },
  });
  return accessSettingsView();
}

// ---------- Telegram-бот входа ----------

export function tgCall(token: string, method: string, body?: unknown) {
  return requestJson(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 15000,
  });
}

const usernames = new Map<string, string>();

export async function botUsername(token: string) {
  const cached = usernames.get(token);
  if (cached) return cached;
  const me = await tgCall(token, "getMe");
  const body = me.body as { ok?: boolean; result?: { username?: string } };
  if (!body?.ok || !body.result?.username) throw new ApiError(401, "Telegram не принял токен бота.", "telegram_unauthorized");
  usernames.set(token, body.result.username);
  return body.result.username;
}

/** Сообщение человеку от бота входа. Никогда не бросает. */
export async function notifyTelegram(chatId: string | null | undefined, text: string) {
  if (!chatId) return false;
  try {
    const { botToken } = await resolvedAccess();
    if (!botToken) return false;
    const result = await tgCall(botToken, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
    return Boolean((result.body as { ok?: boolean })?.ok);
  } catch (error) {
    logEvent("platform.tg_failed", { error: error instanceof Error ? error.message : String(error) }, "warn");
    return false;
  }
}

// ---------- Почта ----------

export async function sendPlatformMail(to: string, subject: string, text: string) {
  const { smtp } = await resolvedAccess();
  if (!smtp.host || !smtp.from) throw new ApiError(503, "Почта для писем не настроена. Администратор задаёт её в Админке → Настройки входа.", "mail_unconfigured");
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  await transporter.sendMail({ from: smtp.from, to, subject, text });
}

export function appUrl() {
  return (process.env.APP_URL || "https://leadflow.siteaccess.ru").replace(/\/$/, "");
}

export const TELEGRAM_EMAIL_DOMAIN = "telegram.local";

export function isServiceEmail(email: string) {
  return email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`);
}

/** Как показать человека: почта, а если он только из Telegram — @username. */
export function contactLabel(user: { email: string; telegramUsername?: string | null; telegramId?: string | null }) {
  if (!isServiceEmail(user.email)) return user.email;
  return user.telegramUsername ? `@${user.telegramUsername}` : `Telegram ${user.telegramId ?? ""}`.trim();
}
