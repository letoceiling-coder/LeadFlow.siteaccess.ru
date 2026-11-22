import { dispatch } from "@/lib/server/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

async function entry(request: Request, context: Ctx) {
  const { path } = await context.params;
  return dispatch(request, path);
}

export const GET = entry;
export const POST = entry;
export const PATCH = entry;
export const PUT = entry;
export const DELETE = entry;
