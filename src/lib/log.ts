/** Журнал: одна строка JSON на событие. Видно в `docker compose logs`, удобно фильтровать grep/jq. Секреты вырезаются. */
function redact(text: string) {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/pai_[A-Za-z0-9_-]+/g, "pai_[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/\/\/[^/@\s]+@/g, "//[redacted]@")
    .replace(/macros\/s\/[A-Za-z0-9_-]+/g, "macros/s/[redacted]");
}

export function logEvent(event: string, data: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  const safe = redact(line).slice(0, 2000);
  if (level === "error") console.error(safe);
  else if (level === "warn") console.warn(safe);
  else console.log(safe);
}
