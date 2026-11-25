import "server-only";
import { randomBytes, randomInt } from "crypto";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { sha256 } from "../crypto";
import { ApiError } from "../errors";
import { createUserSession } from "../auth";
import { logEvent } from "../log";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { ensureStages } from "./common";
import { acceptInvitation, findInvitation } from "./account";
import { TELEGRAM_EMAIL_DOMAIN, appUrl, botUsername, contactLabel, notifyTelegram, resolvedAccess, sendPlatformMail, tgCall } from "./platform";

/**
 * Вход без пароля:
 *  • почта — 6-значный код в письме;
 *  • Telegram — ссылка t.me/<бот>?start=<код>, человек жмёт «Start» и «Подтвердить вход».
 * Новый человек без доступа попадает в заявки (status=pending), администратор привязывает его к пространству.
 */

const EMAIL_TTL_MS = 10 * 60 * 1000;
const TG_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type FlowResult =
  | { status: "ok"; user: { id: string; name: string; tenantName: string } }
  | { status: "pending"; name: string; contact: string };

function normEmail(value: string) {
  return value.trim().toLowerCase();
}

/** Может ли этот вход создать нового человека: да, если это первый пользователь, есть приглашение или открыт приём заявок. */
async function assertCanJoin(inviteToken?: string | null) {
  if (inviteToken) {
    await findInvitation(inviteToken);
    return;
  }
  if ((await prisma.user.count()) === 0) return;
  // ALLOW_REGISTRATION=false — жёсткий замок: новых людей создаёт только администратор в Админке → Люди.
  if (process.env.ALLOW_REGISTRATION === "false") throw new ApiError(403, "Регистрация закрыта. Доступ выдаёт администратор.", "registration_closed");
  const { settings } = await resolvedAccess();
  if (!settings.allowRequests) throw new ApiError(403, "Регистрация сейчас закрыта. Попросите у администратора ссылку-приглашение.", "registration_closed");
}

// ---------- Почта ----------

export async function requestEmailCode(input: { email: string; name?: string | null; inviteToken?: string | null }) {
  const email = normEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.status === "blocked") throw new ApiError(403, "Доступ для этого адреса закрыт администратором.", "user_blocked");
  if (!existing) await assertCanJoin(input.inviteToken);

  const recent = await prisma.authCode.findMany({ where: { kind: "email", email, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" } });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60 * 1000) throw new ApiError(429, "Код уже отправлен. Новый можно запросить через минуту.", "code_cooldown");
  if (recent.length >= 6) throw new ApiError(429, "Слишком много кодов за час. Попробуйте позже.", "rate_limit");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomBytes(12).toString("hex");
  await prisma.authCode.updateMany({ where: { kind: "email", email, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.authCode.create({
    data: {
      id,
      kind: "email",
      email,
      codeHash: sha256(`${id}:${code}`),
      name: input.name?.trim() || null,
      inviteToken: input.inviteToken || null,
      expiresAt: new Date(Date.now() + EMAIL_TTL_MS),
    },
  });

  const text = `Код для входа в LeadFlow: ${code}\n\nОн действует 10 минут. Если вы не запрашивали код — просто удалите письмо.\n\n${appUrl()}`;
  try {
    await sendPlatformMail(email, `Код входа LeadFlow: ${code}`, text);
  } catch (error) {
    // Без настроенной почты в разработке код печатается в лог, чтобы можно было войти локально.
    if (process.env.NODE_ENV !== "production" && error instanceof ApiError && error.code === "mail_unconfigured") {
      logEvent("auth.dev_email_code", { email, code }, "warn");
      return { sent: true, dev: true };
    }
    await prisma.authCode.update({ where: { id }, data: { consumedAt: new Date() } });
    if (error instanceof ApiError) throw error;
    logEvent("auth.mail_failed", { error: error instanceof Error ? error.message : String(error) }, "error");
    throw new ApiError(502, "Не удалось отправить письмо. Проверьте адрес или попробуйте вход через Telegram.", "mail_failed");
  }
  return { sent: true, dev: false };
}

export async function verifyEmailCode(input: { email: string; code: string; inviteToken?: string | null }): Promise<FlowResult> {
  const email = normEmail(input.email);
  const row = await prisma.authCode.findFirst({ where: { kind: "email", email, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row || row.expiresAt < new Date()) throw new ApiError(400, "Код истёк. Запросите новый.", "code_expired");
  if (row.attempts >= MAX_ATTEMPTS) throw new ApiError(429, "Слишком много неверных попыток. Запросите новый код.", "code_attempts");
  if (sha256(`${row.id}:${input.code.trim()}`) !== row.codeHash) {
    await prisma.authCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new ApiError(400, "Неверный код", "code_invalid");
  }
  await prisma.authCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  const inviteToken = input.inviteToken || row.inviteToken;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await assertCanJoin(inviteToken);
    user = await prisma.user.create({
      data: { email, emailVerified: true, name: row.name || email.split("@")[0], passwordHash: unusablePassword(), status: "pending" },
    });
  } else if (!user.emailVerified) {
    user = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  }
  return finish(user, inviteToken);
}

// ---------- Telegram ----------

export async function startTelegramLogin(input: { name?: string | null; inviteToken?: string | null }) {
  const { botToken } = await resolvedAccess();
  if (!botToken) throw new ApiError(503, "Вход через Telegram не настроен. Администратор подключает бота в Админке → Настройки входа.", "telegram_unconfigured");
  if (input.inviteToken) await findInvitation(input.inviteToken);
  const username = await botUsername(botToken);
  const code = randomBytes(16).toString("hex");
  await prisma.authCode.create({
    data: {
      kind: "telegram",
      codeHash: sha256(code),
      name: input.name?.trim() || null,
      inviteToken: input.inviteToken || null,
      expiresAt: new Date(Date.now() + TG_TTL_MS),
    },
  });
  // Код одновременно ключ ожидания: браузер, который начал вход, опрашивает по нему результат.
  return { code, link: `https://t.me/${username}?start=${code}`, botUsername: username, expiresInSec: TG_TTL_MS / 1000 };
}

export async function pollTelegramLogin(code: string): Promise<FlowResult | { status: "waiting"; opened: boolean }> {
  await syncTelegramUpdates();
  const row = await prisma.authCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.kind !== "telegram" || row.consumedAt) throw new ApiError(400, "Ссылка входа уже использована. Начните заново.", "tg_used");
  if (row.expiresAt < new Date()) throw new ApiError(410, "Ссылка входа истекла. Начните заново.", "tg_expired");
  if (!row.confirmedAt || !row.telegramId) return { status: "waiting", opened: Boolean(row.telegramId) };
  await prisma.authCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

  let user = await prisma.user.findUnique({ where: { telegramId: row.telegramId } });
  if (!user) {
    await assertCanJoin(row.inviteToken);
    user = await prisma.user.create({
      data: {
        email: `tg-${row.telegramId}@${TELEGRAM_EMAIL_DOMAIN}`,
        name: row.name || row.telegramName || (row.telegramUsername ? `@${row.telegramUsername}` : "Пользователь Telegram"),
        telegramId: row.telegramId,
        telegramUsername: row.telegramUsername,
        passwordHash: unusablePassword(),
        status: "pending",
      },
    });
  } else if (row.telegramUsername && user.telegramUsername !== row.telegramUsername) {
    user = await prisma.user.update({ where: { id: user.id }, data: { telegramUsername: row.telegramUsername } });
  }
  return finish(user, row.inviteToken);
}

/** Уже вошедший человек привязывает свой Telegram (тогда сможет входить и через него). */
export async function linkTelegramToUser(userId: string, code: string) {
  await syncTelegramUpdates();
  const row = await prisma.authCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.kind !== "telegram" || row.consumedAt || row.expiresAt < new Date()) throw new ApiError(410, "Ссылка истекла. Начните заново.", "tg_expired");
  if (!row.confirmedAt || !row.telegramId) return { linked: false };
  const other = await prisma.user.findUnique({ where: { telegramId: row.telegramId } });
  if (other && other.id !== userId) throw new ApiError(409, "Этот Telegram уже привязан к другому пользователю.", "tg_taken");
  await prisma.authCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { telegramId: row.telegramId, telegramUsername: row.telegramUsername } });
  return { linked: true, username: row.telegramUsername };
}

type TgUser = { id: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
type TgUpdate = {
  update_id: number;
  message?: { message_id: number; text?: string; from?: TgUser; chat?: { id: number; type?: string } };
  callback_query?: { id: string; data?: string; from: TgUser; message?: { message_id: number; chat: { id: number } } };
};

let lastUpdateId = 0;
let syncing: Promise<void> | null = null;

/** Забираем обновления бота входа и разбираем /start <код> и нажатия «Подтвердить». Один опрос за раз на процесс. */
export async function syncTelegramUpdates() {
  if (syncing) return syncing;
  syncing = (async () => {
    const { botToken } = await resolvedAccess();
    if (!botToken) return;
    const response = await tgCall(botToken, "getUpdates", { offset: lastUpdateId + 1, timeout: 0, limit: 100, allowed_updates: ["message", "callback_query"] });
    const body = response.body as { ok?: boolean; result?: TgUpdate[] };
    if (!body?.ok) {
      if (response.response.status === 409) throw new ApiError(409, "У бота входа включён webhook — для входа нужен отдельный бот без webhook.", "telegram_webhook");
      throw new ApiError(502, "Telegram не ответил. Попробуйте ещё раз.", "telegram_updates");
    }
    for (const update of body.result ?? []) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      try {
        await handleUpdate(botToken, update);
      } catch (error) {
        logEvent("auth.tg_update_failed", { error: error instanceof Error ? error.message : String(error) }, "warn");
      }
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

function fullName(user: TgUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || null;
}

async function handleUpdate(token: string, update: TgUpdate) {
  const message = update.message;
  if (message?.text && message.from && !message.from.is_bot && message.chat?.type === "private") {
    const [command, code] = message.text.trim().split(/\s+/);
    if (!command.startsWith("/start")) return;
    if (!code) {
      await tgCall(token, "sendMessage", { chat_id: message.chat.id, text: `Это бот входа в LeadFlow.\nЧтобы войти, откройте ${appUrl()}/login и нажмите «Войти через Telegram».` });
      return;
    }
    const row = await prisma.authCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!row || row.kind !== "telegram" || row.consumedAt || row.expiresAt < new Date()) {
      await tgCall(token, "sendMessage", { chat_id: message.chat.id, text: "Ссылка входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз." });
      return;
    }
    await prisma.authCode.update({
      where: { id: row.id },
      data: { telegramId: String(message.from.id), telegramUsername: message.from.username ?? null, telegramName: fullName(message.from), confirmedAt: null },
    });
    await tgCall(token, "sendMessage", {
      chat_id: message.chat.id,
      text: "Вход в LeadFlow.\n\nНажмите «Подтвердить», только если вы сами только что нажали «Войти через Telegram» на сайте. Если ссылку прислал кто-то другой — не подтверждайте.",
      reply_markup: { inline_keyboard: [[{ text: "✅ Подтвердить вход", callback_data: `ok:${row.id}` }, { text: "Это не я", callback_data: `no:${row.id}` }]] },
    });
    return;
  }

  const callback = update.callback_query;
  if (callback?.data) {
    const [action, id] = callback.data.split(":");
    const row = id ? await prisma.authCode.findUnique({ where: { id } }) : null;
    const valid = row && row.kind === "telegram" && !row.consumedAt && row.expiresAt > new Date() && row.telegramId === String(callback.from.id);
    let answer = "Ссылка устарела";
    if (valid && action === "ok") {
      await prisma.authCode.update({ where: { id: row.id }, data: { confirmedAt: new Date() } });
      answer = "Вход подтверждён — вернитесь на сайт";
    } else if (valid && action === "no") {
      await prisma.authCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      answer = "Вход отменён";
    }
    await tgCall(token, "answerCallbackQuery", { callback_query_id: callback.id, text: answer }).catch(() => undefined);
    if (callback.message) {
      await tgCall(token, "editMessageText", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, text: valid ? (action === "ok" ? "✅ Вход подтверждён. Вернитесь на сайт — страница откроется сама." : "Вход отменён.") : "Ссылка устарела. Начните вход на сайте заново." }).catch(() => undefined);
    }
  }
}

// ---------- Общий финал ----------

function unusablePassword() {
  // Не bcrypt-хеш: verifyPassword всегда вернёт false, вход только по коду или Telegram, пока не задан пароль.
  return `!nopass:${randomBytes(8).toString("hex")}`;
}

async function bootstrapFirstUser(user: User) {
  const tenant = await prisma.tenant.create({ data: { name: "Моё пространство", slug: `workspace-${randomBytes(3).toString("hex")}`, settings: DEFAULT_SETTINGS } });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
  await ensureStages(tenant.id);
  return prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true, status: "active" } });
}

async function finish(input: User, inviteToken?: string | null): Promise<FlowResult> {
  let user = input;
  if (user.status === "blocked") throw new ApiError(403, "Доступ закрыт администратором.", "user_blocked");
  if ((await prisma.user.count()) === 1 && !(await prisma.membership.count({ where: { userId: user.id } }))) {
    user = await bootstrapFirstUser(user);
  }
  let membershipId: string | null = null;
  if (inviteToken) {
    const membership = await acceptInvitation(user, inviteToken);
    membershipId = membership.id;
  }
  const memberships = await prisma.membership.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!memberships.length) {
    const fresh = user.status !== "pending";
    if (fresh) user = await prisma.user.update({ where: { id: user.id }, data: { status: "pending" } });
    await notifyAdminsAboutRequest(user, Date.now() - user.createdAt.getTime() < 60 * 1000);
    return { status: "pending", name: user.name, contact: contactLabel(user) };
  }
  if (user.status !== "active") user = await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const session = await createUserSession(user.id, membershipId ?? memberships[0].id);
  return { status: "ok", user: { id: session.userId, name: session.name, tenantName: session.tenantName } };
}

const notified = new Map<string, number>();

async function notifyAdminsAboutRequest(user: User, isNew: boolean) {
  // Повторные входы человека в ожидании не шлём чаще раза в 6 часов.
  const last = notified.get(user.id) ?? 0;
  if (!isNew && Date.now() - last < 6 * 60 * 60 * 1000) return;
  notified.set(user.id, Date.now());
  const { settings } = await resolvedAccess();
  if (!settings.notifyAdmins) return;
  const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true, status: "active" } });
  const text = `🆕 Заявка на доступ в LeadFlow\n${user.name} — ${contactLabel(user)}\n\nВыдать доступ: ${appUrl()}/admin`;
  for (const admin of admins) {
    const sent = await notifyTelegram(admin.telegramId, text);
    if (!sent && admin.emailVerified && !admin.email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`)) {
      await sendPlatformMail(admin.email, "Новая заявка на доступ в LeadFlow", text).catch(() => undefined);
    }
  }
}

/** Сообщить человеку, что доступ выдан (Telegram или почта). Никогда не бросает. */
export async function notifyAccessGranted(userId: string, tenantName: string, roleLabel: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const text = `✅ Вам открыт доступ в LeadFlow.\nПространство: «${tenantName}», роль: ${roleLabel}.\n\nВойти: ${appUrl()}/login`;
  const sent = await notifyTelegram(user.telegramId, text);
  if (!sent && user.emailVerified && !user.email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`)) {
    await sendPlatformMail(user.email, "Доступ в LeadFlow открыт", text).catch(() => undefined);
  }
}
