import { dispatch } from "@/lib/server/router";
import { toErrorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

async function entry(request: Request, context: Ctx) {
  const { path } = await context.params;
  try {
    // await обязателен: иначе ошибка из вложенного раздела проходит мимо try в dispatch и превращается в пустой 500.
    return await dispatch(request, path);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const GET = entry;
export const POST = entry;
export const PATCH = entry;
export const PUT = entry;
export const DELETE = entry;
