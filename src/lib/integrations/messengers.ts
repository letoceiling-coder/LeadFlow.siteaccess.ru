import "server-only";
import { ApiError, RetryableError } from "../errors";
import { requestJson, retryAfterMs, safeDetail } from "../http";
import { requireReady } from "./config";

/**
 * Telegram и MAX через Parser API (тот же ключ, что и для карт). ТОЛЬКО ЧТЕНИЕ.
 *
 * Аккаунт Telegram, подключённый к ключу парсера, — рабочий аккаунт студии. Поэтому здесь сознательно
 * нет ни отправки сообщений, ни вступления в чаты, ни контактов: LeadFlow только читает открытые
 * каналы и чаты и ищет их по словам. Сообщения лидам человек отправляет сам (кнопка «Скопировать и открыть чат»).
 *
 * Лимиты: не чаще одного запроса в TG_MIN_INTERVAL_MS на процесс; FLOOD_WAIT/429 → RetryableError с паузой.
 */

export type TgPeer = { id: string; type: "channel" | "group" | "supergroup" | "user" | "bot" | "self" | string; title: string; username: string | null; members?: number | null; verified?: boolean };
export type TgMessage = {
  id: number;
  chatId: string | null;
  date: string;
  editDate?: string | null;
  text: string;
  from?: TgPeer | null;
  views?: number | null;
  forwards?: number | null;
  comments?: number | null;
  replyToMessageId?: number | null;
  link?: string | null;
  media?: { type: string } | null;
};
export type TgHistory = { chat: TgPeer; total?: number; messages: TgMessage[] };

const TG_MIN_INTERVAL_MS = Number(process.env.TG_MIN_INTERVAL_MS || 1200);
let lastCallAt = 0;

async function throttle() {
  const wait = lastCallAt + TG_MIN_INTERVAL_MS - Date.now();
  lastCallAt = Math.max(Date.now(), lastCallAt + TG_MIN_INTERVAL_MS);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function mapFailure(status: number, body: unknown, response: Response) {
  const detail = safeDetail(body) ?? "";
  const flood = /FLOOD_WAIT_(\d+)/i.exec(detail);
  if (flood) return new RetryableError(`Telegram просит паузу ${flood[1]} с.`, (Number(flood[1]) + 5) * 1000, true);
  if (status === 429) return new RetryableError("Parser API ограничил частоту запросов к Telegram.", retryAfterMs(response), true);
  if (status === 400) return new ApiError(400, `Telegram: неверный запрос. ${detail}`.trim(), "tg_bad_request");
  if (status === 404) return new ApiError(404, "Telegram: канал или чат не найден (или он закрытый).", "tg_not_found");
  if (status === 401 || status === 403) return new ApiError(status, "Telegram-аккаунт парсера не подключён или нет доступа.", "tg_unauthorized");
  if (status >= 500) return new RetryableError("Telegram через парсер временно недоступен.", 30000, true);
  return new ApiError(502, `Telegram: неожиданный ответ ${status}.`, "tg_unexpected");
}

export class MessengerReader {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    await throttle();
    const url = `${this.baseUrl}${path}${params.size ? `?${params}` : ""}`;
    const { response, body } = await requestJson(url, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeoutMs: 45000 });
    if (response.status !== 200) throw mapFailure(response.status, body, response);
    return body as T;
  }

  /** Подключён ли Telegram-аккаунт к ключу и на связи ли. */
  telegramStatus() {
    return this.get<{ connected: boolean; online: boolean; account?: { id: string; label?: string; user?: { username?: string | null } } }>("/api/v1/telegram/status");
  }

  /** Глобальный поиск Telegram: открытые каналы, группы (и боты/люди — их отбрасываем сами). */
  async search(query: string, limit = 20): Promise<TgPeer[]> {
    const body = await this.get<{ results?: TgPeer[] }>("/api/v1/telegram/search", { q: query, limit });
    return body.results ?? [];
  }

  /** Кто это: канал, группа, человек, бот. `to` — @username, ссылка t.me или id. */
  async resolve(to: string): Promise<TgPeer> {
    const body = await this.get<{ peer: TgPeer }>("/api/v1/telegram/resolve", { to });
    return body.peer;
  }

  /** Последние посты открытого канала (без вступления). */
  channelPosts(channel: string, options: { limit?: number; offsetId?: number } = {}) {
    return this.get<TgHistory>("/api/v1/telegram/channels/posts", { channel, limit: options.limit ?? 20, offsetId: options.offsetId });
  }

  /** История открытого чата/группы (без вступления). minId — читать только новее этого сообщения. */
  history(chat: string, options: { limit?: number; offsetId?: number; search?: string } = {}) {
    return this.get<TgHistory>("/api/v1/telegram/messages", { chat, limit: options.limit ?? 50, offsetId: options.offsetId, search: options.search });
  }

  /** Аккаунты MAX, подключённые к ключу (для кнопки «открыть чат» и статуса). */
  maxProfiles() {
    return this.get<{ profiles: { id: string; label: string; status: string; user?: { name?: string } }[] }>("/api/v1/max/profiles");
  }
}

export async function messengerReader(tenantId: string) {
  const integration = await requireReady(tenantId, "parser", "Telegram через парсер");
  return new MessengerReader(String(integration.config.baseUrl), integration.secrets.apiKey);
}

/** Ссылка на сообщение/канал в открытом Telegram. */
export function tgLink(username: string | null | undefined, messageId?: number) {
  if (!username) return null;
  return `https://t.me/${username.replace(/^@/, "")}${messageId ? `/${messageId}` : ""}`;
}
