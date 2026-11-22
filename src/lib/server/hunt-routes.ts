import { z } from "zod";
import { json, readJson } from "../api";
import { ApiError } from "../errors";
import { can } from "../domain/rbac";
import { SEGMENTS } from "../domain/segments";
import { SCENARIOS, PROJECT_STAGES } from "../domain/scenarios";
import type { AppSession } from "../auth";
import {
  decide,
  decisionSchema,
  dialogs,
  addFact,
  enqueueQualify,
  factSchema,
  followUpDone,
  nextItem,
  searches,
  getItem,
  markSent,
  pitchSchema,
  qualifyPending,
  retryFailed,
  rewritePitch,
  savePitch,
  sentSchema,
  setStatus,
  stats,
  statusSchema,
  today,
} from "../services/hunt";
import { webhookSecret, createProject, getProject, listProjects, projectCreateSchema, projectExport, projectPatchSchema, resendWebhook, updateProject } from "../services/projects";
import { queueFullSync, sheetStatus } from "../services/sheets";
import { systemHealth } from "../services/health";
import { aiStatus, aiUpdateSchema, updateAi } from "../services/ai-settings";

function allow(session: AppSession, permission: string) {
  if (!can(session.role, permission)) throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
}

const qualifySchema = z.object({
  organizationIds: z.array(z.string().min(1)).max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  confirmLarge: z.boolean().optional(),
});

const followUpSchema = z.object({ channel: z.string().trim().min(2).max(20) });

function int(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

/** /api/hunt/* — охота по стратегии NEEKLO: лента, питч, ручная отправка, follow-up, проекты, таблица, цифры. */
export async function huntRoutes(request: Request, session: AppSession, path: string[], url: URL) {
  const tenantId = session.tenantId;
  const method = request.method;
  const [, section, id, action] = path;

  if (section === "today" && method === "GET") {
    allow(session, "org.read");
    return json(await today(tenantId, int(url.searchParams.get("limit"), 20, 1, 50)));
  }
  if (section === "dialogs" && method === "GET") {
    allow(session, "org.read");
    return json(await dialogs(tenantId));
  }
  if (section === "stats" && method === "GET") {
    allow(session, "org.read");
    return json(await stats(tenantId, int(url.searchParams.get("days"), 7, 1, 90)));
  }
  if (section === "segments" && method === "GET") return json(SEGMENTS);
  if (section === "next" && method === "GET") {
    allow(session, "org.read");
    return json(await nextItem(tenantId, url.searchParams.get("after")));
  }
  if (section === "searches" && method === "GET") {
    allow(session, "org.read");
    return json(await searches(tenantId));
  }
  if (section === "ai" && !id && method === "GET") {
    allow(session, "integrations.manage");
    return json(await aiStatus(tenantId));
  }
  if (section === "ai" && id === "update" && method === "POST") {
    allow(session, "integrations.manage");
    return json(await updateAi(tenantId, session.userId, aiUpdateSchema.parse(await readJson(request))));
  }
  if (section === "health" && method === "GET") {
    allow(session, "org.read");
    return json(await systemHealth(tenantId));
  }
  if (section === "scenarios" && method === "GET") return json({ scenarios: SCENARIOS, stages: PROJECT_STAGES });
  if (section === "qualify" && method === "POST") {
    allow(session, "analysis.manage");
    const body = qualifySchema.parse(await readJson(request));
    if (body.organizationIds?.length) return json(await enqueueQualify(tenantId, session.userId, body.organizationIds, body.confirmLarge), 202);
    return json(await qualifyPending(tenantId, session.userId, body.limit ?? 20, body.confirmLarge), 202);
  }
  if (section === "retry-failed" && method === "POST") {
    allow(session, "analysis.manage");
    return json(await retryFailed(tenantId, session.userId), 202);
  }

  if (section === "webhook-secret" && method === "GET") {
    allow(session, "settings.manage");
    return json({ secret: webhookSecret(tenantId), header: "X-LeadFlow-Signature", algorithm: "HMAC-SHA256 от тела запроса, формат sha256=<hex>" });
  }
  if (section === "sheets") {
    if (method === "GET") {
      allow(session, "org.read");
      return json(await sheetStatus(tenantId));
    }
    if (id === "sync" && method === "POST") {
      allow(session, "integrations.manage");
      return json(await queueFullSync(tenantId), 202);
    }
  }

  if (section === "projects") {
    if (!id && method === "GET") {
      allow(session, "crm.read");
      return json(await listProjects(tenantId, url.searchParams.get("stage")));
    }
    if (!id && method === "POST") {
      allow(session, "crm.manage");
      return json(await createProject(tenantId, session.userId, projectCreateSchema.parse(await readJson(request))), 201);
    }
    if (id && !action && method === "GET") {
      allow(session, "crm.read");
      return json(await getProject(tenantId, id));
    }
    if (id && !action && method === "PATCH") {
      allow(session, "crm.manage");
      return json(await updateProject(tenantId, session.userId, id, projectPatchSchema.parse(await readJson(request))));
    }
    if (id && action === "json" && method === "GET") {
      allow(session, "crm.read");
      const data = await projectExport(tenantId, id);
      // Файл для скачивания: тот же JSON, что уходит во внешний API.
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="project-${id}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (id && action === "webhook" && method === "POST") {
      allow(session, "crm.manage");
      return json(await resendWebhook(tenantId, id), 202);
    }
    throw new ApiError(404, "Действие с проектом не найдено", "not_found");
  }

  const itemId = section;
  if (!itemId) throw new ApiError(404, "Раздел не найден", "not_found");
  const itemAction = path[2];
  if (path.length === 2 && method === "GET") {
    allow(session, "org.read");
    return json(await getItem(tenantId, itemId));
  }
  allow(session, "lead.manage");
  if (itemAction === "decide" && method === "POST") return json(await decide(tenantId, session.userId, itemId, decisionSchema.parse(await readJson(request))));
  if (itemAction === "fact" && method === "POST") return json(await addFact(tenantId, session.userId, itemId, factSchema.parse(await readJson(request))));
  if (itemAction === "pitch" && path[3] === "rewrite" && method === "POST") return json(await rewritePitch(tenantId, itemId));
  if (itemAction === "pitch" && method === "PUT") return json(await savePitch(tenantId, itemId, pitchSchema.parse(await readJson(request)).text));
  if (itemAction === "sent" && method === "POST") return json(await markSent(tenantId, session.userId, session.role, itemId, sentSchema.parse(await readJson(request))));
  if (itemAction === "followup" && method === "POST") return json(await followUpDone(tenantId, session.userId, itemId, followUpSchema.parse(await readJson(request)).channel));
  if (itemAction === "status" && method === "POST") return json(await setStatus(tenantId, session.userId, itemId, statusSchema.parse(await readJson(request))));
  throw new ApiError(404, "Действие не найдено", "not_found");
}
