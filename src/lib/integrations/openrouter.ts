import { z } from "zod";
import { AI_MODELS, knownModel, resolveTaskModel } from "../domain/models";
import { ApiError, RetryableError } from "../errors";
import { requestJson, retryAfterMs, safeDetail } from "../http";
import { DEFAULT_OPENROUTER_PROXY } from "./catalog";

/**
 * Прокси для OpenRouter (с сервера в РФ напрямую OpenRouter отвечает 403).
 * Порядок: прокси из интеграции (вводится в админке, хранится зашифрованным) → OPENROUTER_PROXY_URL → запасной.
 * Значение "direct" — без прокси.
 */
export function openRouterProxy(secrets?: Record<string, string> | null): string | undefined {
  const fromIntegration = secrets?.proxyUrl?.trim();
  if (fromIntegration) return fromIntegration === "direct" ? undefined : fromIntegration;
  const raw = process.env.OPENROUTER_PROXY_URL;
  if (raw !== undefined && raw.trim() === "direct") return undefined;
  return raw?.trim() || DEFAULT_OPENROUTER_PROXY;
}

/** Прокси вводит человек: только http(s)://[логин:пароль@]хост:порт или "direct". */
export function validProxy(value: string): string | null {
  const clean = value.trim();
  if (clean === "direct") return clean;
  try {
    const url = new URL(clean);
    // Подключение через прокси умеет только http:// (CONNECT) — https-прокси молча не работал бы.
    if (url.protocol !== "http:" || !url.hostname || !url.port) return null;
    return clean;
  } catch {
    return null;
  }
}

export const analysisResultSchema = z.object({
  summary: z.string().min(1),
  activities: z.array(z.string()).default([]),
  services: z.array(z.string()).default([]),
  problems: z.array(z.object({ text: z.string(), kind: z.enum(["fact", "assumption", "unknown"]) })).default([]),
  opportunities: z.array(z.object({ text: z.string(), kind: z.enum(["fact", "assumption", "unknown"]) })).default([]),
  siteStructure: z.array(z.string()).default([]),
  style: z.string().nullable().optional(),
  blocks: z.array(z.string()).default([]),
  priorityFeatures: z.array(z.string()).default([]),
  reasoning: z.array(z.object({ text: z.string(), kind: z.enum(["fact", "assumption", "unknown"]) })).default([]),
  sources: z.array(z.object({ field: z.string(), origin: z.string() })).default([]),
  unknowns: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  commercialPotential: z.boolean().nullable(),
});

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export async function completeJson(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodTypeAny;
  maxTokens: number;
  /** Секреты интеграции: из них берётся прокси, введённый в админке. */
  secrets?: Record<string, string>;
}) {
  if (!options.model.trim()) {
    throw new ApiError(422, "Модель AI не выбрана. Укажите её в настройках.", "model_required");
  }
  const run = async (extra: string, maxTokens = options.maxTokens): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } }> => {
    const { response, body } = await requestJson(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      timeoutMs: 60000,
      proxy: openRouterProxy(options.secrets),
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0.1,
        max_tokens: maxTokens,
        // Модели с рассуждением (GLM) иначе тратят весь лимит на «мысли» и возвращают пустой ответ. Коротко и без текста рассуждений — в 4 раза дешевле.
        reasoning: { effort: "low", exclude: true },
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: `${options.user}\n${extra}` },
        ],
      }),
    });
    if (response.status === 401) throw new ApiError(401, "Ключ OpenRouter не принят.", "openrouter_unauthorized");
    if (response.status === 402) throw new ApiError(402, "На балансе OpenRouter не хватает средств.", "openrouter_payment");
    if (response.status === 429) throw new RetryableError("OpenRouter ограничил частоту запросов.", retryAfterMs(response), true);
    if (response.status >= 500) throw new RetryableError("OpenRouter временно недоступен.", 15000, true);
    if (!response.ok) throw new ApiError(502, safeDetail(body) || "OpenRouter вернул ошибку.", "openrouter_error");
    const record = body as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const content = record.choices?.[0]?.message?.content;
    if (!content) {
      // Пустой ответ почти всегда значит «упёрлись в лимит токенов» — один повтор с двойным лимитом.
      if (maxTokens === options.maxTokens) return run(extra, options.maxTokens * 2);
      throw new ApiError(502, "Модель вернула пустой ответ.", "openrouter_empty");
    }
    return { content, usage: record.usage ?? {} };
  };

  let first = await run("Верни только JSON.");
  try {
    return { data: options.schema.parse(extractJson(first.content)), usage: first.usage, text: first.content };
  } catch {
    first = await run("Прошлый ответ не прошёл проверку схемы. Верни только исправленный JSON, без пояснений.");
    try {
      return { data: options.schema.parse(extractJson(first.content)), usage: first.usage, text: first.content };
    } catch {
      throw new ApiError(502, "Модель вернула ответ, который не удалось разобрать. Повтор не создал сохранённый отчёт.", "ai_invalid_json");
    }
  }
}

export const AGENT_MODELS = AI_MODELS;

export function agentModelChoice(value: string | null | undefined) {
  return knownModel(value);
}

export function resolveAgentModel(value: string | null | undefined) {
  const known = knownModel(value) ?? knownModel(process.env.AGENT_MODEL);
  if (known) return known.slug;
  return resolveTaskModel("agent");
}

export function agentModel() {
  return resolveAgentModel("");
}

export type ChatMessage = {
  role: string;
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

export async function completeTools(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  secrets?: Record<string, string>;
}) {
  const { response, body } = await requestJson(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    timeoutMs: 90000,
    proxy: openRouterProxy(options.secrets),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.3,
      max_tokens: 1800,
      tools: options.tools.map((tool) => ({ type: "function", function: tool })),
      messages: options.messages,
    }),
  });
  if (response.status === 401) throw new ApiError(401, "Ключ OpenRouter не принят.", "openrouter_unauthorized");
  if (response.status === 402) throw new ApiError(402, "На балансе OpenRouter не хватает средств.", "openrouter_payment");
  if (response.status === 429) throw new RetryableError("OpenRouter ограничил частоту запросов.", retryAfterMs(response), true);
  if (response.status >= 500) throw new RetryableError("OpenRouter временно недоступен.", 15000, true);
  if (!response.ok) throw new ApiError(502, `${response.status} ${safeDetail(body) || "без текста"}`.slice(0, 300), "openrouter_error");
  const record = body as {
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const message = record.choices?.[0]?.message;
  if (!message) throw new ApiError(502, "Модель вернула пустой ответ.", "openrouter_empty");
  return { message, usage: record.usage ?? {} };
}
