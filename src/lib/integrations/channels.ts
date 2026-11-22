import "server-only";
import nodemailer from "nodemailer";
import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ApiError } from "../errors";
import { requestJson } from "../http";
import { openRouterProxy } from "./openrouter";
import type { ResolvedIntegration } from "./config";

export async function testIntegration(integration: ResolvedIntegration): Promise<{ scopes: string[]; detail: string }> {
  if (!integration.configured) throw new ApiError(422, "Сначала сохраните учётные данные.", "integration_not_configured");
  if (integration.provider === "sheets") {
    const { pingSheets } = await import("./sheets");
    const result = await pingSheets(integration.secrets);
    return { scopes: ["rows:write"], detail: `Таблица ответила${result.title ? `: «${result.title}»` : ""}. Листы создадутся при первой записи.` };
  }
  if (integration.provider === "parser") {
    const base = String(integration.config.baseUrl);
    const health = await requestJson(`${base}/health`, { timeoutMs: 8000 });
    if (!health.response.ok) throw new ApiError(502, "Parser API не ответил на проверку доступности.", "parser_down");
    const probe = await requestJson(`${base}/api/v1/organizations?limit=0`, {
      headers: { Authorization: `Bearer ${integration.secrets.apiKey}` },
      timeoutMs: 15000,
    });
    if (probe.response.status === 401) throw new ApiError(401, "Ключ Parser API отклонён.", "parser_unauthorized");
    if (probe.response.status === 403) throw new ApiError(403, "У ключа нет права organizations:read.", "parser_forbidden");
    if (!probe.response.ok) throw new ApiError(502, "Ключ не прошёл проверку чтения базы.", "parser_check_failed");
    return { scopes: ["organizations:read"], detail: "Ключ прошёл проверку чтения базы. Права на задачи подтвердятся при первом запуске." };
  }
  if (integration.provider === "studio") {
    const base = String(integration.config.baseUrl);
    const me = await requestJson(`${base}/auth/me`, { headers: { Authorization: `Bearer ${integration.secrets.apiKey}` }, timeoutMs: 15000 });
    if (!me.response.ok) throw new ApiError(401, "Ключ Studio отклонён.", "studio_unauthorized");
    const scopes = Array.isArray((me.body as { apiKey?: { scopes?: string[] } })?.apiKey?.scopes)
      ? ((me.body as { apiKey: { scopes: string[] } }).apiKey.scopes)
      : [];
    return { scopes, detail: scopes.length ? `Подтверждены права: ${scopes.join(", ")}` : "Ключ принят. Список прав в ответе не пришёл." };
  }
  if (integration.provider === "openrouter") {
    const base = String(integration.config.baseUrl);
    const models = await requestJson(`${base}/models`, {
      headers: { Authorization: `Bearer ${integration.secrets.apiKey}` },
      timeoutMs: 20000,
      proxy: openRouterProxy(),
    });
    if (models.response.status === 401) throw new ApiError(401, "Ключ OpenRouter отклонён.", "openrouter_unauthorized");
    if (!models.response.ok) throw new ApiError(502, "OpenRouter не подтвердил ключ.", "openrouter_check_failed");
    return { scopes: ["chat"], detail: "Ключ принят. Баланс и точная стоимость станут известны после вызова, если сервис их вернёт." };
  }
  if (integration.provider === "email") {
    const transporter = nodemailer.createTransport({
      host: integration.secrets.host,
      port: Number(integration.secrets.port || 587),
      secure: Number(integration.secrets.port || 587) === 465,
      auth: integration.secrets.user ? { user: integration.secrets.user, pass: integration.secrets.password || "" } : undefined,
    });
    await transporter.verify();
    return { scopes: ["smtp"], detail: "SMTP-сервер принял проверку. Письмо не отправлялось." };
  }
  if (integration.provider === "telegram") {
    const me = await requestJson(`https://api.telegram.org/bot${integration.secrets.botToken}/getMe`, { timeoutMs: 15000 });
    const ok = Boolean((me.body as { ok?: boolean })?.ok);
    if (!ok) throw new ApiError(401, "Telegram не принял токен бота.", "telegram_unauthorized");
    return { scopes: ["bot"], detail: "Бот подтверждён. Номера из карточек не превращаются в чаты." };
  }
  if (integration.provider === "whatsapp") {
    const url = `https://graph.facebook.com/v21.0/${integration.secrets.phoneNumberId}?fields=display_phone_number`;
    const probe = await requestJson(url, { headers: { Authorization: `Bearer ${integration.secrets.token}` }, timeoutMs: 15000 });
    if (!probe.response.ok) throw new ApiError(401, "WhatsApp не подтвердил номер или токен.", "whatsapp_unauthorized");
    return { scopes: ["whatsapp"], detail: "Номер подтверждён. Сообщения не отправлялись." };
  }
  if (integration.provider === "sms") {
    const probe = await requestJson(`https://sms.ru/my/balance?api_id=${encodeURIComponent(integration.secrets.apiId)}&json=1`, { timeoutMs: 15000 });
    const status = (probe.body as { status?: string })?.status;
    if (status !== "OK") throw new ApiError(401, "SMS.ru не принял api_id.", "sms_unauthorized");
    return { scopes: ["smsru"], detail: "Баланс проверен. SMS не отправлялось." };
  }
  const prefix = String(integration.config.prefix || "leadflow").replace(/^\/+|\/+$/g, "");
  const endpoint = integration.secrets.endpoint.startsWith("http") ? integration.secrets.endpoint : `https://${integration.secrets.endpoint}`;
  const client = new S3Client({
    region: integration.secrets.region || "us-east-1",
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: integration.secrets.accessKey, secretAccessKey: integration.secrets.secretKey },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: integration.secrets.bucket }));
    await client.send(new PutObjectCommand({
      Bucket: integration.secrets.bucket,
      Key: `${prefix}/.keep`,
      Body: "leadflow",
      ContentType: "text/plain",
    }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    throw new ApiError(502, `Хранилище не подтвердило бакет или папку ${prefix} (${name}).`, "storage_check_failed");
  }
  return { scopes: ["s3"], detail: `Бакет доступен. Файлы проекта пишутся в папку ${prefix}/.` };
}

export async function deliverMessage(integration: ResolvedIntegration, input: { to: string; subject?: string; body: string; html?: string; listUnsubscribe?: string }) {
  if (integration.provider === "email") {
    const transporter = nodemailer.createTransport({
      host: integration.secrets.host,
      port: Number(integration.secrets.port || 587),
      secure: Number(integration.secrets.port || 587) === 465,
      auth: integration.secrets.user ? { user: integration.secrets.user, pass: integration.secrets.password || "" } : undefined,
    });
    const info = await transporter.sendMail({
      from: integration.secrets.from,
      to: input.to,
      subject: input.subject || "Сообщение",
      text: input.body,
      html: input.html,
      headers: input.listUnsubscribe ? { "List-Unsubscribe": `<${input.listUnsubscribe}>` } : undefined,
    });
    return { externalId: info.messageId || null };
  }
  if (integration.provider === "telegram") {
    const chatId = input.to || integration.secrets.chatId;
    if (!chatId) throw new ApiError(422, "Для Telegram нужен chat id. Номер телефона из карты не подходит.", "telegram_chat_required");
    const result = await requestJson(`https://api.telegram.org/bot${integration.secrets.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: input.body }),
    });
    if (!(result.body as { ok?: boolean })?.ok) throw new ApiError(502, "Telegram не принял сообщение.", "telegram_send_failed");
    return { externalId: String((result.body as { result?: { message_id?: number } }).result?.message_id ?? "") };
  }
  if (integration.provider === "whatsapp") {
    const templateName = typeof integration.config.templateName === "string" ? integration.config.templateName : "";
    if (!templateName) {
      throw new ApiError(422, "Для WhatsApp укажите имя одобренного шаблона в настройках интеграции. Свободный текст не отправляется.", "whatsapp_template_required");
    }
    const result = await requestJson(`https://graph.facebook.com/v21.0/${integration.secrets.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${integration.secrets.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to.replace(/\D/g, ""),
        type: "template",
        template: { name: templateName, language: { code: "ru" }, components: [{ type: "body", parameters: [{ type: "text", text: input.body.slice(0, 900) }] }] },
      }),
    });
    if (!result.response.ok) throw new ApiError(502, "WhatsApp не принял сообщение.", "whatsapp_send_failed");
    return { externalId: (result.body as { messages?: { id?: string }[] }).messages?.[0]?.id ?? null };
  }
  if (integration.provider === "sms") {
    const result = await requestJson("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_id: integration.secrets.apiId, to: input.to, msg: input.body, json: "1" }),
    });
    if ((result.body as { status?: string })?.status !== "OK") throw new ApiError(502, "SMS-провайдер не принял сообщение.", "sms_send_failed");
    return { externalId: null };
  }
  throw new ApiError(422, "У этого канала нет отправки.", "channel_unsupported");
}
