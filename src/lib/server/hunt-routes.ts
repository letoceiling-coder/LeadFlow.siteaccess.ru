import { z } from "zod";
import { json, readJson } from "../api";
import { ApiError } from "../errors";
import { can } from "../domain/rbac";
import { SEGMENTS } from "../domain/segments";
import type { AppSession } from "../auth";
import {
  decide,
  decisionSchema,
  dialogs,
  enqueueQualify,
  followUpDone,
  getItem,
  markSent,
  pitchSchema,
  qualifyPending,
  rewritePitch,
  savePitch,
  sentSchema,
  setStatus,
  stats,
  statusSchema,
  today,
} from "../services/hunt";

function allow(session: AppSession, permission: string) {
  if (!can(session.role, permission)) throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
}

const qualifySchema = z.object({
  organizationIds: z.array(z.string().min(1)).max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  confirmLarge: z.boolean().optional(),
});

const followUpSchema = z.object({ channel: z.string().trim().min(2).max(20) });

/** /api/hunt/* — охота по стратегии NEEKLO: лента, питч, ручная отправка, follow-up, цифры. */
export async function huntRoutes(request: Request, session: AppSession, path: string[], url: URL) {
  const tenantId = session.tenantId;
  const method = request.method;

  if (path[1] === "today" && method === "GET") {
    allow(session, "org.read");
    return json(await today(tenantId, Number(url.searchParams.get("limit") || 10)));
  }
  if (path[1] === "dialogs" && method === "GET") {
    allow(session, "org.read");
    return json(await dialogs(tenantId));
  }
  if (path[1] === "stats" && method === "GET") {
    allow(session, "org.read");
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || 7)));
    return json(await stats(tenantId, days));
  }
  if (path[1] === "segments" && method === "GET") return json(SEGMENTS);
  if (path[1] === "qualify" && method === "POST") {
    allow(session, "analysis.manage");
    const body = qualifySchema.parse(await readJson(request));
    if (body.organizationIds?.length) return json(await enqueueQualify(tenantId, session.userId, body.organizationIds, body.confirmLarge), 202);
    return json(await qualifyPending(tenantId, session.userId, body.limit ?? 20, body.confirmLarge), 202);
  }

  const id = path[1];
  if (!id) throw new ApiError(404, "Раздел не найден", "not_found");
  if (path.length === 2 && method === "GET") {
    allow(session, "org.read");
    return json(await getItem(tenantId, id));
  }
  allow(session, "lead.manage");
  if (path[2] === "decide" && method === "POST") return json(await decide(tenantId, session.userId, id, decisionSchema.parse(await readJson(request))));
  if (path[2] === "pitch" && method === "PUT") return json(await savePitch(tenantId, id, pitchSchema.parse(await readJson(request)).text));
  if (path[2] === "pitch" && path[3] === "rewrite" && method === "POST") return json(await rewritePitch(tenantId, id));
  if (path[2] === "sent" && method === "POST") return json(await markSent(tenantId, session.userId, id, sentSchema.parse(await readJson(request))));
  if (path[2] === "followup" && method === "POST") return json(await followUpDone(tenantId, session.userId, id, followUpSchema.parse(await readJson(request)).channel));
  if (path[2] === "status" && method === "POST") return json(await setStatus(tenantId, session.userId, id, statusSchema.parse(await readJson(request))));
  throw new ApiError(404, "Действие не найдено", "not_found");
}
