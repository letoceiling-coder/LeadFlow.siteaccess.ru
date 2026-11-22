export const ALLOWED_TRIGGERS = [
  "organization.created",
  "analysis.completed",
  "score.updated",
  "site.created",
  "qa.completed",
  "demo.approved",
  "message.replied",
  "deal.won",
  "schedule.tick",
] as const;

export const ALLOWED_ACTIONS = [
  "compute_score",
  "enqueue_analysis",
  "create_task",
  "notify",
  "move_stage",
  "prepare_draft",
  "suggest_demo",
] as const;

const FORBIDDEN = new Set(["send_message", "publish_site", "start_campaign"]);

export type Condition = { field: string; op: "eq" | "neq" | "gte" | "lte" | "exists"; value?: string | number | boolean | null };
export type ConditionGroup = { all?: Condition[]; any?: Condition[] };

export function validateAutomation(input: { trigger: string; actions: { type: string }[]; intervalMinutes?: number | null }) {
  if (!(ALLOWED_TRIGGERS as readonly string[]).includes(input.trigger)) {
    return "Неизвестный триггер";
  }
  if (!input.actions.length) return "Добавьте хотя бы одно действие";
  for (const action of input.actions) {
    if (FORBIDDEN.has(action.type)) return "Автоматизация не может отправлять сообщения, публиковать сайты или запускать кампании";
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(action.type)) return `Действие «${action.type}» не поддерживается`;
    if (input.trigger === "schedule.tick" && action.type !== "notify") {
      return "Правило по расписанию может только создавать внутреннее напоминание";
    }
    if (input.trigger === "analysis.completed" && action.type === "enqueue_analysis") {
      return "После анализа нельзя снова запускать анализ: иначе правило зациклится";
    }
  }
  if (input.intervalMinutes != null && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 15)) {
    return "Интервал расписания не меньше 15 минут";
  }
  return null;
}

function compare(actual: unknown, condition: Condition): boolean {
  if (condition.op === "exists") return actual !== null && actual !== undefined && actual !== "";
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "neq") return actual !== condition.value;
  const left = typeof actual === "number" ? actual : Number(actual);
  const right = typeof condition.value === "number" ? condition.value : Number(condition.value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (condition.op === "gte") return left >= right;
  if (condition.op === "lte") return left <= right;
  return false;
}

export function evaluateConditions(group: ConditionGroup | null | undefined, payload: Record<string, unknown>): boolean {
  if (!group || ((!group.all || group.all.length === 0) && (!group.any || group.any.length === 0))) return true;
  const allOk = (group.all ?? []).every((condition) => compare(payload[condition.field], condition));
  const anyOk = !group.any?.length || group.any.some((condition) => compare(payload[condition.field], condition));
  return allOk && anyOk;
}
