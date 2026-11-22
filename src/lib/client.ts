export class ApiClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/login")) {
    window.location.href = "/login";
  }
  if (!response.ok || body?.ok === false) {
    throw new ApiClientError(body?.error?.message || "Запрос не выполнен", body?.error?.code, response.status);
  }
  return body.data as T;
}

export function isSetupError(error: unknown) {
  return error instanceof ApiClientError && (error.code === "integration_not_configured" || error.code === "integration_unverified" || error.code === "model_required" || error.code === "auth_unconfigured" || error.code === "encryption_unconfigured");
}
