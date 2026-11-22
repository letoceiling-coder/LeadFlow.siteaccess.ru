import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin, getSession, type AppSession } from "./auth";
import { can } from "./domain/rbac";
import { ApiError, safeLog } from "./errors";

type Handler = (request: Request, session: AppSession, params: Record<string, string>) => Promise<NextResponse> | NextResponse;

export function json(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function route(options: { permission?: string; mutate?: boolean }, handler: Handler) {
  return async (request: Request, context?: { params?: Promise<Record<string, string>> }) => {
    try {
      if (options.mutate !== false && request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
      const session = await getSession();
      if (!session) throw new ApiError(401, "Войдите в систему", "auth_required");
      if (options.permission && !can(session.role, options.permission)) {
        throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
      }
      const params = context?.params ? await context.params : {};
      return await handler(request, session, params);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Ожидался JSON", "invalid_json");
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: { message: "Проверьте заполнение полей", code: "validation", details: error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ ok: false, error: { message: error.message, code: error.code, hint: error.hint } }, { status: error.status });
  }
  safeLog("api", error);
  return NextResponse.json(
    { ok: false, error: { message: "Внутренняя ошибка. Попробуйте ещё раз. Технические детали не показываются.", code: "internal" } },
    { status: 500 },
  );
}
