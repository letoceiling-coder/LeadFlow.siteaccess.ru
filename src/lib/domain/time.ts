/** Границы «сегодня» в часовом поясе пространства, а не сервера (в Docker сервер живёт в UTC). */

export const DEFAULT_TIMEZONE = "Europe/Moscow";

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Смещение пояса от UTC в минутах для момента `at`. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Начало и конец локального дня (как моменты UTC), в который попадает `at`. */
export function dayBounds(timeZone: string, at = new Date()) {
  const offset = tzOffsetMinutes(timeZone, at);
  const local = new Date(at.getTime() + offset * 60000);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(midnightLocalAsUtc - offset * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}
