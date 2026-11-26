import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "../db";
import { decryptSecret, encryptSecret, sha256 } from "../crypto";
import { ApiError } from "../errors";
import { requestJson } from "../http";
import { logEvent } from "../log";
import { audit } from "./common";
import { callbackData, escapeHtml, findingMessage, parseCallback, weeklyReportText } from "../domain/radar";
import { laterFinding, rejectFinding, takeFinding } from "./radar";

/**
 * Бот заказчика (сценарий 4). Токен вводит человек в настройках проекта, хранится зашифрованным (encryptSecret),
 * в логи и ответы API не попадает. Получатель — один чат, привязанный через /start <код>.
 * Бот пишет ТОЛЬКО этому чату (заказчику в его же бот), участникам чатов — никогда.
 * Нажатия кнопок приходят на webhook /api/radar-bot/<projectId> с секретом в заголовке
 * X-Telegram-Bot-Api-Secret-Token — не занимает обработчик задач и срабатывает сразу.
 */

const BIND_TTL_MS = 30 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type TgResult<T = unknown> = { ok?: boolean; description?: string; result?: T };

async function tg<T = unknown>(token: string, method: string, body?: unknown): Promise<TgResult<T>> {
  const { body: out } = await requestJson(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    timeoutMs: 15000,
  });
  return (out ?? {}) as TgResult<T>;
}

function appUrl() {
  const raw = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  if (!/^https:\/\//.test(raw)) throw new ApiError(422, "Для бота нужен публичный адрес сервиса по https (APP_URL).", "app_url_required");
  return raw;
}

async function projectWithToken(tenantId: string, projectId: string) {
  const project = await prisma.radarProject.findFirst({ where: { id: projectId, tenantId } });
  if (!project) throw new ApiError(404, "Проект радара не найден", "not_found");
  return { project, token: project.botTokenEnc ? decryptSecret(project.botTokenEnc) : null };
}

/** Подключить бота: проверить токен, поставить webhook с секретом, выдать ссылку привязки. */
export async function connectBot(tenantId: string, actorId: string, projectId: string, rawToken: string) {
  const token = rawToken.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new ApiError(400, "Токен бота выглядит как 123456789:AA… — возьмите его у @BotFather.", "bad_bot_token");
  const { project } = await projectWithToken(tenantId, projectId);
  if (project.kind !== "client") throw new ApiError(409, "Бот подключается к проекту-клиенту.", "radar_not_client");
  const me = await tg<{ username?: string }>(token, "getMe");
  if (!me.ok || !me.result?.username) throw new ApiError(401, "Telegram не принял токен бота.", "telegram_unauthorized");
  const secret = randomBytes(24).toString("hex");
  const hook = await tg(token, "setWebhook", { url: `${appUrl()}/api/radar-bot/${projectId}`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  if (!hook.ok) throw new ApiError(502, `Telegram не принял webhook: ${hook.description ?? "без описания"}`.slice(0, 200), "telegram_webhook");
  const code = randomBytes(12).toString("hex");
  await prisma.radarProject.update({
    where: { id: projectId },
    data: { botTokenEnc: encryptSecret(token), botUsername: me.result.username, hookSecretHash: sha256(secret), bindCodeHash: sha256(code), bindExpiresAt: new Date(Date.now() + BIND_TTL_MS), botChatId: null, botChatTitle: null },
  });
  await audit({ tenantId, actorId, action: "radar.bot_connect", entityType: "radar", entityId: projectId });
  return { botUsername: me.result.username, link: `https://t.me/${me.result.username}?start=${code}`, expiresInSec: BIND_TTL_MS / 1000 };
}

/** Новая ссылка привязки (например, сменился получатель). */
export async function bindLink(tenantId: string, actorId: string, projectId: string) {
  const { project, token } = await projectWithToken(tenantId, projectId);
  if (!token || !project.botUsername) throw new ApiError(422, "Сначала подключите бота токеном.", "telegram_bot_required");
  const code = randomBytes(12).toString("hex");
  await prisma.radarProject.update({ where: { id: projectId }, data: { bindCodeHash: sha256(code), bindExpiresAt: new Date(Date.now() + BIND_TTL_MS) } });
  await audit({ tenantId, actorId, action: "radar.bot_bind", entityType: "radar", entityId: projectId });
  return { botUsername: project.botUsername, link: `https://t.me/${project.botUsername}?start=${code}`, expiresInSec: BIND_TTL_MS / 1000 };
}

export async function disconnectBot(tenantId: string, actorId: string, projectId: string) {
  const { token } = await projectWithToken(tenantId, projectId);
  if (token) await tg(token, "deleteWebhook", {}).catch(() => undefined);
  await prisma.radarProject.update({ where: { id: projectId }, data: { botTokenEnc: null, botUsername: null, botChatId: null, botChatTitle: null, hookSecretHash: null, bindCodeHash: null, bindExpiresAt: null } });
  await audit({ tenantId, actorId, action: "radar.bot_disconnect", entityType: "radar", entityId: projectId });
  return { ok: true };
}

function keyboard(findingId: string) {
  return { inline_keyboard: [[{ text: "✅ Взять", callback_data: callbackData("take", findingId) }, { text: "🚫 Не то", callback_data: callbackData("reject", findingId) }, { text: "⏰ Позже", callback_data: callbackData("later", findingId) }]] };
}

function doneKeyboard(status: "taken" | "rejected" | "later", authorUsername: string | null) {
  const label = status === "taken" ? "✅ Взято" : status === "rejected" ? "🚫 Не то — учтём" : "⏰ Отложено на сутки";
  const row: Record<string, string>[] = [{ text: label, callback_data: "r:noop" }];
  if (status === "taken" && authorUsername) row.push({ text: "Написать автору", url: `https://t.me/${authorUsername}` });
  return { inline_keyboard: [row] };
}

/** Отправить находку заказчику в его бот. Никогда не пишет никому, кроме привязанного чата. */
export async function deliverFinding(findingId: string) {
  const finding = await prisma.radarFinding.findUnique({ where: { id: findingId }, include: { project: true } });
  if (!finding || finding.botMessageId || !finding.project.botTokenEnc || !finding.project.botChatId) return false;
  const token = decryptSecret(finding.project.botTokenEnc);
  const sent = await tg<{ message_id: number }>(token, "sendMessage", { chat_id: finding.project.botChatId, text: findingMessage(finding), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard(finding.id) });
  if (!sent.ok || !sent.result) {
    logEvent("radar.bot_send_failed", { project: finding.projectId, error: (sent.description ?? "").slice(0, 120) }, "warn");
    return false;
  }
  await prisma.radarFinding.update({ where: { id: finding.id }, data: { botMessageId: sent.result.message_id } });
  await new Promise((resolve) => setTimeout(resolve, 1100)); // лимит Telegram: не чаще сообщения в секунду в один чат
  return true;
}

async function reportFor(projectId: string, from: Date, to: Date) {
  const project = await prisma.radarProject.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(404, "Проект радара не найден", "not_found");
  const where = { projectId, createdAt: { gte: from, lt: to } };
  const [byStatus, byChat] = await Promise.all([
    prisma.radarFinding.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.radarFinding.groupBy({ by: ["chatTitle"], where, _count: { _all: true }, orderBy: { _count: { chatTitle: "desc" } }, take: 5 }),
  ]);
  const count = (status: string) => byStatus.find((item) => item.status === status)?._count._all ?? 0;
  return {
    project,
    text: weeklyReportText({
      projectName: project.name, from, to, total: byStatus.reduce((sum, item) => sum + item._count._all, 0), taken: count("taken"), rejected: count("rejected"), later: count("later"), fresh: count("new"),
      topChats: byChat.map((item) => ({ title: item.chatTitle, count: item._count._all })),
    }),
  };
}

/** Недельный отчёт: раз в 7 дней после создания проекта (или прошлого отчёта). Вызывается из опроса. */
export async function maybeWeeklyReport(projectId: string) {
  const project = await prisma.radarProject.findUnique({ where: { id: projectId } });
  if (!project?.botTokenEnc || !project.botChatId) return false;
  const base = project.lastReportAt ?? project.createdAt;
  if (Date.now() - base.getTime() < WEEK_MS) return false;
  return sendReport(projectId, new Date(Date.now() - WEEK_MS), new Date());
}

async function sendReport(projectId: string, from: Date, to: Date) {
  const { project, text } = await reportFor(projectId, from, to);
  if (!project.botTokenEnc || !project.botChatId) throw new ApiError(422, "Бот не подключён или получатель не привязан.", "telegram_not_linked");
  const sent = await tg(decryptSecret(project.botTokenEnc), "sendMessage", { chat_id: project.botChatId, text, parse_mode: "HTML", disable_web_page_preview: true });
  await prisma.radarProject.update({ where: { id: projectId }, data: { lastReportAt: new Date() } });
  return Boolean(sent.ok);
}

export async function reportNow(tenantId: string, actorId: string, projectId: string) {
  await projectWithToken(tenantId, projectId);
  const ok = await sendReport(projectId, new Date(Date.now() - WEEK_MS), new Date());
  await audit({ tenantId, actorId, action: "radar.bot_report", entityType: "radar", entityId: projectId });
  if (!ok) throw new ApiError(502, "Telegram не принял отчёт.", "telegram_send");
  return { ok: true };
}

export async function testBot(tenantId: string, actorId: string, projectId: string) {
  const { project, token } = await projectWithToken(tenantId, projectId);
  if (!token || !project.botChatId) throw new ApiError(422, "Бот не подключён или получатель не привязан.", "telegram_not_linked");
  const sent = await tg(token, "sendMessage", { chat_id: project.botChatId, text: `✅ Радар «${escapeHtml(project.name)}» на связи. Новые запросы будут приходить сюда с кнопками «Взять / Не то / Позже».`, parse_mode: "HTML" });
  await audit({ tenantId, actorId, action: "radar.bot_test", entityType: "radar", entityId: projectId });
  if (!sent.ok) throw new ApiError(502, "Telegram не принял сообщение.", "telegram_send");
  return { ok: true };
}

type Update = {
  message?: { text?: string; chat?: { id: number; type?: string; title?: string; username?: string; first_name?: string } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat?: { id: number } } };
};

/** Webhook бота. Чужой секрет — 401 без деталей. Ошибки обработки не выдаём наружу (Telegram повторял бы запрос). */
export async function handleBotUpdate(projectId: string, secretHeader: string | null, update: Update) {
  const project = await prisma.radarProject.findUnique({ where: { id: projectId } });
  if (!project?.hookSecretHash || !secretHeader || sha256(secretHeader) !== project.hookSecretHash || !project.botTokenEnc) return { status: 401 };
  const token = decryptSecret(project.botTokenEnc);

  const message = update.message;
  if (message?.text && message.chat) {
    const [command, code] = message.text.trim().split(/\s+/);
    if (command?.startsWith("/start")) {
      const valid = code && project.bindCodeHash && sha256(code) === project.bindCodeHash && project.bindExpiresAt && project.bindExpiresAt > new Date();
      if (!valid) {
        await tg(token, "sendMessage", { chat_id: message.chat.id, text: project.botChatId && String(message.chat.id) === project.botChatId ? "Радар уже присылает запросы сюда." : "Ссылка привязки устарела. Попросите новую в LeadFlow." });
        return { status: 200 };
      }
      const chat = message.chat;
      const title = chat.title || (chat.username ? `@${chat.username}` : chat.first_name) || String(chat.id);
      await prisma.radarProject.update({ where: { id: projectId }, data: { botChatId: String(chat.id), botChatTitle: title.slice(0, 120), bindCodeHash: null, bindExpiresAt: null } });
      await tg(token, "sendMessage", { chat_id: chat.id, text: `✅ Готово: сюда будут приходить запросы радара «${project.name}». Кнопки под каждым: «Взять», «Не то» (похожие станут ниже), «Позже».` });
      logEvent("radar.bot_bound", { tenant: project.tenantId, project: projectId });
    }
    return { status: 200 };
  }

  const query = update.callback_query;
  if (query) {
    const parsed = parseCallback(query.data);
    const fromOwner = project.botChatId && String(query.message?.chat?.id) === project.botChatId;
    if (!parsed || !fromOwner) {
      await tg(token, "answerCallbackQuery", { callback_query_id: query.id });
      return { status: 200 };
    }
    const finding = await prisma.radarFinding.findFirst({ where: { id: parsed.findingId, projectId } });
    if (!finding) {
      await tg(token, "answerCallbackQuery", { callback_query_id: query.id, text: "Запрос не найден" });
      return { status: 200 };
    }
    const tenantId = project.tenantId;
    if (parsed.action === "take") await takeFinding(tenantId, null, finding.id);
    else if (parsed.action === "reject") await rejectFinding(tenantId, null, finding.id, "bot");
    else await laterFinding(tenantId, null, finding.id);
    const status = parsed.action === "take" ? "taken" : parsed.action === "reject" ? "rejected" : "later";
    await tg(token, "answerCallbackQuery", { callback_query_id: query.id, text: status === "rejected" ? "Учтём: похожие будут ниже" : status === "taken" ? "Взято" : "Напомним завтра" });
    if (query.message) await tg(token, "editMessageReplyMarkup", { chat_id: project.botChatId, message_id: query.message.message_id, reply_markup: doneKeyboard(status, finding.authorUsername) });
    return { status: 200 };
  }
  return { status: 200 };
}
