/** Недорогие модели с вызовом инструментов и JSON. Claude, GPT и старшие Pro/Opus сюда не входят. */
export const AI_MODELS = [
  { id: "deepseek", label: "DeepSeek V4 Flash", detail: "агент и инструменты", slug: "deepseek/deepseek-v4-flash" },
  { id: "gemma", label: "Gemma 4 31B", detail: "тексты", slug: "google/gemma-4-31b-it" },
  { id: "glm", label: "GLM 5.3 Flash", detail: "структурный разбор", slug: "z-ai/glm-5.3-flash" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];
export type AiTask = "agent" | "analysis" | "brief" | "message";

export const TASK_MODEL: Record<AiTask, AiModelId> = {
  agent: "deepseek",
  analysis: "glm",
  brief: "gemma",
  message: "gemma",
};

export function knownModel(value: string | null | undefined) {
  const clean = value?.trim() || "";
  return AI_MODELS.find((item) => item.id === clean || item.slug === clean) ?? null;
}

export function resolveTaskModel(task: AiTask, value?: string | null) {
  return (knownModel(value) ?? AI_MODELS.find((item) => item.id === TASK_MODEL[task])!).slug;
}

export function taskModelId(task: AiTask, value?: string | null) {
  return (knownModel(value) ?? AI_MODELS.find((item) => item.id === TASK_MODEL[task])!).id;
}
