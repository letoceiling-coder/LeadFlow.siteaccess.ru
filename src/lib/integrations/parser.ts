import { ApiError, RetryableError } from "../errors";
import { requestJson, retryAfterMs, safeDetail } from "../http";

export type ParserTaskPayload = {
  type: string;
  input: Record<string, unknown>;
  options?: { timeoutMs?: number; maxRetries?: number; priority?: number };
};

function mapFailure(status: number, body: unknown, response: Response) {
  const detail = safeDetail(body);
  const suffix = detail ? ` ${detail}` : "";
  if (status === 400) return new ApiError(400, `Parser API отклонил параметры.${suffix}`, "parser_bad_request");
  if (status === 401) return new ApiError(401, "Ключ Parser API не принят.", "parser_unauthorized", "Проверьте ключ в интеграциях.");
  if (status === 403) return new ApiError(403, "У ключа Parser API нет нужного права.", "parser_forbidden");
  if (status === 404) return new ApiError(404, "Parser API не нашёл объект.", "parser_not_found");
  if (status === 409) return new ApiError(409, "Задачу уже нельзя изменить.", "parser_conflict");
  if (status === 429) return new RetryableError("Parser API ограничил частоту запросов.", retryAfterMs(response), true);
  if (status >= 500) return new RetryableError("Parser API временно недоступен.", 15000, true);
  return new ApiError(502, "Parser API вернул неожиданный ответ.", "parser_unexpected");
}

export class ParserClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit & { timeoutMs?: number } = {}, ok: number[] = [200]) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const { response, body } = await requestJson(`${this.baseUrl}${path}`, { ...init, headers, timeoutMs: init.timeoutMs ?? 30000 });
    if (!ok.includes(response.status)) throw mapFailure(response.status, body, response);
    return body;
  }

  health() {
    return requestJson(`${this.baseUrl}/health`, { timeoutMs: 8000 });
  }

  createTask(payload: ParserTaskPayload, idempotencyKey: string) {
    return this.call("/api/v1/tasks", { method: "POST", body: JSON.stringify(payload), headers: { "Idempotency-Key": idempotencyKey } }, [200, 201]);
  }

  getTask(id: string) {
    return this.call(`/api/v1/tasks/${encodeURIComponent(id)}`);
  }

  cancelTask(id: string) {
    return this.call(`/api/v1/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  organizations(query: URLSearchParams) {
    return this.call(`/api/v1/organizations?${query.toString()}`);
  }

  organization(id: string) {
    return this.call(`/api/v1/organizations/${encodeURIComponent(id)}`);
  }

  cities(query: URLSearchParams) {
    return this.call(`/api/v1/organizations/cities?${query.toString()}`);
  }

  categories(query: URLSearchParams) {
    return this.call(`/api/v1/organizations/categories?${query.toString()}`);
  }

  /** HTML страницы через браузер парсера (синхронно, до ~45 с). Нужен для скана сайта лида. */
  pageHtml(url: string, idempotencyKey: string) {
    return this.call("/api/v1/page/html", { method: "POST", body: JSON.stringify({ url, includeText: true, absoluteUrls: true, stripScripts: true, maxBytes: 1500000 }), headers: { "Idempotency-Key": idempotencyKey }, timeoutMs: 70000 }, [200, 201, 202]);
  }

  /** Массовый сбор организаций: промпт или город + категория, до 500 карточек, со всеми полями. */
  collect(body: Record<string, unknown>, idempotencyKey: string) {
    return this.call("/api/v1/organizations/collect", { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": idempotencyKey } }, [200, 201, 202]);
  }

  collectStatus(id: string) {
    return this.call(`/api/v1/organizations/collect/${encodeURIComponent(id)}`);
  }

  collectResult(id: string) {
    return this.call(`/api/v1/organizations/collect/${encodeURIComponent(id)}/result`, { timeoutMs: 60000 });
  }

  workers() {
    return this.call("/api/v1/workers");
  }
}

export function asTask(body: unknown) {
  if (!body || typeof body !== "object" || typeof (body as { id?: unknown }).id !== "string") {
    throw new ApiError(502, "Parser API вернул задачу без идентификатора.", "parser_shape");
  }
  const task = body as {
    id: string;
    status?: string;
    progress?: number;
    result?: unknown;
    error?: unknown;
    startedAt?: string;
    completedAt?: string;
  };
  return task;
}
