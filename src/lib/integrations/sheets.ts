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
  if (!response.ok) {
    // Google отдаёт свою HTML-страницу ошибки — показывать её пользователю бессмысленно.
    if (response.status === 404) {
      throw new ApiError(502, "Google не нашёл веб-приложение по этой ссылке (404). Скопируйте ссылку …/exec заново: Развернуть → Управление развёртываниями → актуальное развёртывание.", "sheets_not_found");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(502, "Google требует вход. В развёртывании поставьте «У кого есть доступ: Все» и обновите версию.", "sheets_forbidden");
    }
    const detail = safeDetail(reply);
    throw new ApiError(502, detail && !/<html|<!doctype/i.test(detail) ? detail : `Таблица ответила ${response.status}.`, "sheets_http");
  }
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

/** Лист старого скрипта: до разбивки по нишам он принимал только «Лиды» и «Проекты». */
export const LEGACY_LEAD_SHEET = "Лиды";
const LEGACY_TTL_MS = 10 * 60 * 1000;
/** Ссылки, где стоит старый скрипт. Через 10 минут пробуем листы ниш снова — вдруг скрипт обновили. */
const legacyScripts = new Map<string, number>();

function isUnknownSheet(error: unknown) {
  return error instanceof ApiError && error.code === "sheets_bad_reply" && /unknown sheet/i.test(error.message);
}

/**
 * family — все листы этой группы: строка с тем же id на другом листе группы переносится сюда.
 * Запасной путь: если в таблице старый скрипт (не знает листов ниш), пишем лидов в «Лиды», чтобы выгрузка не стояла.
 */
export async function upsertRows(secrets: SheetsSecrets, sheet: string, header: string[], rows: Record<string, unknown>[], family: string[] = []) {
  if (!rows.length) return { written: 0 };
  const url = secrets.webhookUrl?.trim() ?? "";
  const leads = family.length > 0 && sheet !== LEGACY_LEAD_SHEET;
  const since = legacyScripts.get(url);
  const legacy = leads && since !== undefined && Date.now() - since < LEGACY_TTL_MS;
  if (!legacy) {
    try {
      const result = await call(secrets, { action: "upsert", sheet, key: "id", header, rows, family });
      if (since !== undefined) legacyScripts.delete(url);
      return { written: result.written ?? rows.length, sheet };
    } catch (error) {
      if (!leads || !isUnknownSheet(error)) throw error;
      legacyScripts.set(url, Date.now());
    }
  }
  const result = await call(secrets, { action: "upsert", sheet: LEGACY_LEAD_SHEET, key: "id", header, rows, family: [LEGACY_LEAD_SHEET] });
  return { written: result.written ?? rows.length, sheet: LEGACY_LEAD_SHEET, legacy: true };
}
