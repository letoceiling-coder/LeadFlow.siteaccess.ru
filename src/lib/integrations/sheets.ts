import "server-only";
import { ApiError, RetryableError } from "../errors";
import { requestJson, safeDetail } from "../http";

/**
 * Google Таблицы через веб-приложение Apps Script (deploy/google-sheets/Code.gs).
 * Сервер шлёт JSON, скрипт сам создаёт листы и обновляет строки по колонке «id».
 */

const EXEC_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export function assertSheetsUrl(url: string | undefined) {
  if (!url || !EXEC_URL.test(url.trim())) {
    throw new ApiError(400, "Нужна ссылка веб-приложения Apps Script вида https://script.google.com/macros/s/…/exec", "sheets_bad_url");
  }
  return url.trim();
}

type SheetsSecrets = { webhookUrl?: string; token?: string };
type SheetsReply = { ok?: boolean; error?: string; title?: string; written?: number };

async function call(secrets: SheetsSecrets, body: Record<string, unknown>): Promise<SheetsReply> {
  const url = assertSheetsUrl(secrets.webhookUrl);
  const { response, body: reply } = await requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, token: secrets.token }),
    redirect: "follow",
    timeoutMs: 30000,
  });
  if (response.status === 429 || response.status >= 500) throw new RetryableError("Google Таблица временно недоступна.", 30000, true);
  const data = (reply ?? {}) as SheetsReply;
  if (!response.ok) throw new ApiError(502, safeDetail(reply) || `Таблица ответила ${response.status}.`, "sheets_http");
  if (data.ok !== true) {
    if (data.error === "unauthorized") throw new ApiError(401, "Токен не совпал с токеном в Apps Script.", "sheets_unauthorized");
    // HTML вместо JSON — обычно скрипт развёрнут не «для всех» или требует входа.
    throw new ApiError(502, data.error && data.error.length < 160 ? `Таблица: ${data.error}` : "Скрипт ответил не JSON. Проверьте, что веб-приложение доступно «Всем».", "sheets_bad_reply");
  }
  return data;
}

export async function pingSheets(secrets: SheetsSecrets) {
  return call(secrets, { action: "ping" });
}

export async function upsertRows(secrets: SheetsSecrets, sheet: string, header: string[], rows: Record<string, unknown>[]) {
  if (!rows.length) return { written: 0 };
  const result = await call(secrets, { action: "upsert", sheet, key: "id", header, rows });
  return { written: result.written ?? rows.length };
}
