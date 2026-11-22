import { ApiError, RetryableError } from "../errors";
import { requestJson, retryAfterMs, safeDetail } from "../http";

function mapFailure(status: number, body: unknown, response: Response) {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "studio_error";
  const detail = safeDetail(body);
  if (status === 401) return new ApiError(401, "Ключ Website AI Studio не принят.", code, "Проверьте ключ в интеграциях.");
  if (status === 403) return new ApiError(403, "У ключа Studio не хватает права.", code);
  if (status === 404) return new ApiError(404, "Проект Studio не найден.", code);
  if (status === 409) return new RetryableError(detail || "Агент Studio уже занят. Запрос повторно поставлен в очередь.", 20000, false);
  if (status === 422) return new ApiError(422, detail || "Studio отклонил повтор запроса из-за другого тела.", code);
  if (status === 429) return new RetryableError("Studio ограничил частоту или квоту.", retryAfterMs(response, 20000), true);
  if (status >= 500) return new RetryableError("Website AI Studio временно недоступен.", 15000, true);
  return new ApiError(status || 502, detail || "Studio вернул ошибку.", code);
}

export class StudioClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit & { timeoutMs?: number } = {}, ok: number[] = [200]) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const { response, body } = await requestJson(`${this.baseUrl}${path}`, { ...init, headers, timeoutMs: init.timeoutMs ?? 60000 });
    if (!ok.includes(response.status)) throw mapFailure(response.status, body, response);
    return { body, headers: response.headers };
  }

  me() {
    return this.call("/auth/me");
  }

  createProject(input: { name: string; description?: string }, idempotencyKey: string) {
    return this.call("/projects", { method: "POST", body: JSON.stringify(input), headers: { "Idempotency-Key": idempotencyKey } }, [201, 200]);
  }

  getProject(id: string) {
    return this.call(`/projects/${id}`);
  }

  startAgent(id: string, text: string, mode: "build" | "chat", idempotencyKey: string) {
    return this.call(
      `/projects/${id}/agent/tasks`,
      { method: "POST", body: JSON.stringify({ text, mode }), headers: { "Idempotency-Key": idempotencyKey } },
      [202, 200],
    );
  }

  getAgentTask(taskId: string, wait = 0) {
    return this.call(`/agent/tasks/${encodeURIComponent(taskId)}?wait=${Math.min(Math.max(wait, 0), 50)}`);
  }

  cancelAgent(taskId: string) {
    return this.call(`/agent/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
  }

  messages(id: string) {
    return this.call(`/projects/${id}/agent/messages`);
  }

  previewUrl(id: string) {
    return this.call(`/projects/${id}/preview-url`);
  }

  qaLatest(id: string) {
    return this.call(`/projects/${id}/qa/latest`);
  }

  async thumbnail(id: string) {
    const headers = new Headers({ Authorization: `Bearer ${this.apiKey}` });
    const response = await fetch(`${this.baseUrl}/projects/${id}/thumbnail`, { headers, cache: "no-store" });
    if (!response.ok) throw mapFailure(response.status, null, response);
    return Buffer.from(await response.arrayBuffer());
  }

  versions(id: string) {
    return this.call(`/projects/${id}/versions`);
  }

  checkpoint(id: string, message: string) {
    return this.call(`/projects/${id}/checkpoints`, { method: "POST", body: JSON.stringify({ message }) }, [200, 201]);
  }

  restore(id: string, sha: string) {
    return this.call(`/projects/${id}/restore`, { method: "POST", body: JSON.stringify({ sha }) }, [200, 201]);
  }

  diff(id: string, from: string, to: string) {
    return this.call(`/projects/${id}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  publish(id: string, visibility: "public" | "private") {
    return this.call(`/projects/${id}/publish`, { method: "POST", body: JSON.stringify({ visibility }) }, [202, 200]);
  }

  publishStatus(id: string) {
    return this.call(`/projects/${id}/publish`);
  }

  deleteProject(id: string) {
    return this.call(`/projects/${id}`, { method: "DELETE" }, [200, 204]);
  }
}
