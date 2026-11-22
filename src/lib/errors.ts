export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
    public hint?: string,
  ) {
    super(message);
  }
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public delayMs = 15000,
    public consumeAttempt = false,
  ) {
    super(message);
  }
}

export class FatalJobError extends Error {}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof RetryableError || error instanceof FatalJobError) return error.message;
  if (error instanceof Error && error.message && !/prisma|Bearer|pai_|lsk_/i.test(error.message)) {
    return "Операция не выполнена. Подробности записаны в журнал сервера.";
  }
  return "Операция не выполнена. Подробности записаны в журнал сервера.";
}

export function safeLog(scope: string, error: unknown) {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const clean = raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/pai_[A-Za-z0-9_-]+/g, "pai_[redacted]")
    .replace(/lsk_[A-Za-z0-9_-]+/g, "lsk_[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/api_id=[^&\s]+/gi, "api_id=[redacted]")
    .slice(0, 1000);
  console.error(`[${scope}] ${clean}`);
}
