import http from "node:http";
import tls from "node:tls";
import type { Socket } from "node:net";
import { ApiError } from "./errors";

type JsonInit = RequestInit & { timeoutMs?: number; proxy?: string };

export async function requestJson(url: string, init: JsonInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 20000);
  const rest: RequestInit = { ...init };
  delete (rest as JsonInit).timeoutMs;
  delete (rest as JsonInit).proxy;
  try {
    const response = init.proxy
      ? await fetchViaProxy(url, rest, init.proxy, controller.signal)
      : await fetch(url, { ...rest, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 300) };
      }
    }
    return { response, body };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "Внешний сервис не ответил вовремя", "timeout", "Повторите действие позже. Уже сохранённые данные не удаляются.");
    }
    const proxyStatus = error instanceof Error ? /^proxy_connect_(\d+)/.exec(error.message)?.[1] : undefined;
    if (proxyStatus === "407") {
      throw new ApiError(502, "Прокси требует логин и пароль (ответ 407)", "network", "Впишите прокси полностью: http://логин:пароль@хост:порт в «Охота» → шестерёнка → AI-скоринг.");
    }
    if (proxyStatus) {
      throw new ApiError(502, `Прокси отказал в соединении (ответ ${proxyStatus})`, "network", "Проверьте, что IP сервера разрешён на прокси, и адрес прокси в «Охота» → шестерёнка → AI-скоринг.");
    }
    throw new ApiError(502, init.proxy ? "Прокси не отвечает" : "Не удалось связаться с внешним сервисом", "network", "Проверьте доступность сервиса и ключ в разделе «Интеграции».");
  } finally {
    clearTimeout(timeout);
  }
}

function detailText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return detailText(record.message) || detailText(record.error);
}

export function safeDetail(body: unknown): string | null {
  const value = detailText(body);
  if (!value) return null;
  if (/bearer|pai_|lsk_|api[_-]?key|token/i.test(value)) return null;
  return value.slice(0, 180);
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function bodyBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error("unsupported_proxy_body");
}

function decodeChunks(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const lineEnd = data.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const size = Number.parseInt(data.subarray(offset, lineEnd).toString("latin1").split(";")[0] || "", 16);
    if (!Number.isFinite(size)) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    parts.push(data.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(parts);
}

function readProxyResponse(raw: Buffer): Response {
  const separator = raw.indexOf("\r\n\r\n");
  if (separator < 0) throw new Error("proxy_bad_response");
  const lines = raw.subarray(0, separator).toString("latin1").split("\r\n");
  const status = Number(lines[0]?.split(" ")[1] || 502);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  let body = raw.subarray(separator + 4);
  if ((headers.get("transfer-encoding") || "").toLowerCase().includes("chunked")) {
    body = decodeChunks(body);
    headers.delete("transfer-encoding");
  }
  return new Response(new Uint8Array(body), { status: Number.isFinite(status) ? status : 502, headers });
}

function writeProxyRequest(stream: Socket, target: URL, init: RequestInit, payload: Buffer | undefined) {
  const lines = [`${(init.method || "GET").toUpperCase()} ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.hostname}`];
  for (const [key, value] of Object.entries(headerRecord(init.headers))) {
    if (/^(host|content-length|connection)$/i.test(key)) continue;
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) throw new Error("bad_header");
    lines.push(`${key}: ${value}`);
  }
  if (payload) lines.push(`Content-Length: ${payload.length}`);
  lines.push("Connection: close", "", "");
  stream.write(lines.join("\r\n"));
  if (payload) stream.write(payload);
}

function fetchViaProxy(url: string, init: RequestInit, proxy: string, signal: AbortSignal): Promise<Response> {
  const target = new URL(url);
  const proxyUrl = new URL(proxy);
  if (proxyUrl.protocol !== "http:") return Promise.reject(new Error("proxy_protocol"));
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  const payload = bodyBuffer(init.body);

  return new Promise((resolve, reject) => {
    let settled = false;
    let active: Socket | http.ClientRequest | null = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const succeed = (response: Response) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(response);
    };
    const onAbort = () => {
      active?.destroy();
      const error = new Error("aborted");
      error.name = "AbortError";
      fail(error);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    const connectHeaders: Record<string, string> = { Host: `${target.hostname}:${port}` };
    if (proxyUrl.username) {
      const token = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64");
      connectHeaders["Proxy-Authorization"] = `Basic ${token}`;
    }
    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port || 80),
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers: connectHeaders,
    });
    active = connectReq;
    connectReq.on("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`proxy_connect_${response.statusCode ?? "failed"}`));
        return;
      }
      if (head?.length) socket.unshift(head);
      const stream: Socket = target.protocol === "https:" ? tls.connect({ socket, servername: target.hostname, ALPNProtocols: ["http/1.1"] }) : socket;
      active = stream;
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on("end", () => {
        try {
          succeed(readProxyResponse(Buffer.concat(chunks)));
        } catch (error) {
          fail(error);
        }
      });
      stream.on("error", fail);
      const send = () => {
        try {
          writeProxyRequest(stream, target, init, payload);
        } catch (error) {
          fail(error);
        }
      };
      if (target.protocol === "https:") stream.once("secureConnect", send);
      else send();
    });
    connectReq.on("error", fail);
    connectReq.end();
  });
}

export function retryAfterMs(response: Response, fallback = 15000): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 120000);
  return fallback;
}
