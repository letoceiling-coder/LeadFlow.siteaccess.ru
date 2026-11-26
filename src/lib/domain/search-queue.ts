/**
 * Очередь поисков по картам. Ключ Parser API тянет один сбор за раз: остальные ждут в LeadFlow
 * и уходят в парсер сами, когда предыдущий закончился. Здесь — только чистая логика (без базы),
 * чтобы её можно было проверить тестами.
 */

export type QueueTask = {
  id: string;
  type: string;
  status: string;
  externalId: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  input?: unknown;
};

/** Источники поиска: карты (сбор организаций), сайты (скан сайтов найденных), Telegram-каналы. */
export const SEARCH_SOURCES = ["maps", "sites", "telegram"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export const SOURCE_LABEL: Record<SearchSource, string> = { maps: "Карты", sites: "Сайты", telegram: "Telegram-каналы" };

/** Сбор, который держит единственное место в парсере, считается живым не дольше 6 часов (потом опрос ставит «ошибку»). */
export const SLOT_TTL_MS = 6 * 60 * 60 * 1000;

const OPEN = ["queued", "running"];

export function isCollect(task: Pick<QueueTask, "type">) {
  return task.type === "organizations.collect";
}

/** Сбор уже отдан парсеру (или отдаётся прямо сейчас) и не закончился — место занято. */
export function holdsSlot(task: QueueTask, now = Date.now()) {
  if (!isCollect(task) || !OPEN.includes(task.status)) return false;
  if (!task.dispatchedAt && !task.externalId) return false;
  return now - task.createdAt.getTime() < SLOT_TTL_MS;
}

/** Ждёт своей очереди в LeadFlow: создан, но ещё не отдан парсеру. */
export function isWaiting(task: QueueTask) {
  return isCollect(task) && task.status === "queued" && !task.dispatchedAt && !task.externalId;
}

/** Порядок очереди: кто раньше поставлен, тот раньше уходит в парсер. */
export function waitingOrder(tasks: QueueTask[]) {
  return tasks.filter(isWaiting).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** Кого отдать парсеру сейчас: никого, если место занято, иначе первого в очереди. */
export function pickNext(tasks: QueueTask[], now = Date.now()): QueueTask | null {
  if (tasks.some((task) => holdsSlot(task, now))) return null;
  return waitingOrder(tasks)[0] ?? null;
}

export type QueueInfo = {
  /** Номер в очереди: 1 — сейчас у парсера, 2 — следующий и т. д. null — сбор уже не в очереди. */
  position: number | null;
  state: "waiting" | "sending" | "collecting" | "retrying" | "done";
  /** Номер попытки при повторе на другом сервере парсера (2, 3…), иначе 1. */
  attempt: number;
  label: string | null;
};

function attemptsOf(input: unknown) {
  const list = input && typeof input === "object" ? (input as { attempts?: unknown }).attempts : null;
  return Array.isArray(list) ? list.length : 0;
}

/** Место каждого сбора в очереди и короткая подпись для экрана. */
export function queueInfo(tasks: QueueTask[], now = Date.now()): Map<string, QueueInfo> {
  const result = new Map<string, QueueInfo>();
  const busy = tasks.some((task) => holdsSlot(task, now));
  const waiting = waitingOrder(tasks);
  const offset = busy ? 2 : 1;
  waiting.forEach((task, index) => {
    const position = index + offset;
    result.set(task.id, { position, state: "waiting", attempt: 1, label: `в очереди №${position}` });
  });
  for (const task of tasks) {
    if (result.has(task.id)) continue;
    const attempt = attemptsOf(task.input) + 1;
    if (!holdsSlot(task, now)) {
      result.set(task.id, { position: null, state: "done", attempt, label: null });
      continue;
    }
    if (attempt > 1 && !task.externalId) result.set(task.id, { position: 1, state: "retrying", attempt, label: `повтор на другом сервере (попытка ${attempt})` });
    else if (!task.externalId) result.set(task.id, { position: 1, state: "sending", attempt, label: "отправляем в парсер" });
    else if (attempt > 1) result.set(task.id, { position: 1, state: "retrying", attempt, label: `собирает (другой сервер, попытка ${attempt})` });
    else result.set(task.id, { position: 1, state: "collecting", attempt, label: task.status === "running" ? "собирает" : "парсер принял" });
  }
  return result;
}

/** Источники из входа поиска. Старые поиски — только карты и сайты. */
export function sourcesOf(input: unknown): SearchSource[] {
  const raw = input && typeof input === "object" ? (input as { sources?: unknown }).sources : null;
  if (!Array.isArray(raw)) return ["maps", "sites"];
  const list = raw.filter((item): item is SearchSource => SEARCH_SOURCES.includes(item as SearchSource));
  return list.length ? list : ["maps", "sites"];
}
