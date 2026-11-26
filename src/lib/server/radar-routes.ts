import { z } from "zod";
import { json, readJson } from "../api";
import { ApiError } from "../errors";
import { can } from "../domain/rbac";
import type { AppSession } from "../auth";
import {
  addRadarSource,
  createRadarProject,
  deleteRadarProject,
  deleteRadarSource,
  laterFinding,
  patchRadarSource,
  pollNow,
  radarConfigSchema,
  radarFeed,
  radarFeedQuerySchema,
  radarOverview,
  radarProjectPatchSchema,
  radarProjectSchema,
  radarSourceSchema,
  updateRadarProject,
  rejectFinding,
  saveRadarConfig,
  searchRadarChats,
  takeFinding,
} from "../services/radar";
import { bindLink, connectBot, disconnectBot, reportNow, testBot } from "../services/radar-bot";

function allow(session: AppSession, permission: string) {
  if (!can(session.role, permission)) throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
}

const botSchema = z.object({ token: z.string().trim().min(10).max(200) });
const laterSchema = z.object({ hours: z.number().int().min(1).max(24 * 14).optional() });

/** /api/hunt/radar/* — радар намерений. `rest` — путь после «radar». */
export async function radarRoutes(request: Request, session: AppSession, rest: string[], url: URL) {
  const tenantId = session.tenantId;
  const method = request.method;
  const [section, id, action, sub] = rest;

  if (!section && method === "GET") {
    allow(session, "org.read");
    return json(await radarOverview(tenantId));
  }
  if (section === "feed" && method === "GET") {
    allow(session, "org.read");
    return json(await radarFeed(tenantId, radarFeedQuerySchema.parse(Object.fromEntries(url.searchParams))));
  }
  if (section === "search" && method === "GET") {
    allow(session, "search.manage");
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 3) throw new ApiError(400, "Введите хотя бы 3 буквы.", "radar_query");
    return json(await searchRadarChats(tenantId, q));
  }
  if (section === "config" && method === "PUT") {
    allow(session, "integrations.manage");
    return json(await saveRadarConfig(tenantId, session.userId, radarConfigSchema.parse(await readJson(request))));
  }
  if (section === "findings" && id) {
    allow(session, "lead.manage");
    if (action === "take" && method === "POST") return json(await takeFinding(tenantId, session.userId, id));
    if (action === "reject" && method === "POST") return json(await rejectFinding(tenantId, session.userId, id));
    if (action === "later" && method === "POST") return json(await laterFinding(tenantId, session.userId, id, laterSchema.parse(await readJson(request).catch(() => ({}))).hours));
  }
  if (section === "sources" && id) {
    allow(session, "search.manage");
    if (method === "PATCH") return json(await patchRadarSource(tenantId, id, z.object({ active: z.boolean() }).parse(await readJson(request)).active));
    if (method === "DELETE") return json(await deleteRadarSource(tenantId, session.userId, id));
  }
  if (section === "projects") {
    if (!id && method === "POST") {
      allow(session, "search.manage");
      return json(await createRadarProject(tenantId, session.userId, radarProjectSchema.parse(await readJson(request))), 201);
    }
    if (id && !action && method === "PATCH") {
      allow(session, "search.manage");
      return json(await updateRadarProject(tenantId, session.userId, id, radarProjectPatchSchema.parse(await readJson(request))));
    }
    if (id && !action && method === "DELETE") {
      allow(session, "search.manage");
      return json(await deleteRadarProject(tenantId, session.userId, id));
    }
    if (id && action === "sources" && method === "POST") {
      allow(session, "search.manage");
      return json(await addRadarSource(tenantId, session.userId, id, radarSourceSchema.parse(await readJson(request)).ref), 201);
    }
    if (id && action === "poll" && method === "POST") {
      allow(session, "search.manage");
      return json(await pollNow(tenantId, id), 202);
    }
    if (id && action === "bot") {
      allow(session, "integrations.manage");
      if (!sub && method === "POST") return json(await connectBot(tenantId, session.userId, id, botSchema.parse(await readJson(request)).token));
      if (!sub && method === "DELETE") return json(await disconnectBot(tenantId, session.userId, id));
      if (sub === "bind" && method === "POST") return json(await bindLink(tenantId, session.userId, id));
      if (sub === "test" && method === "POST") return json(await testBot(tenantId, session.userId, id));
      if (sub === "report" && method === "POST") return json(await reportNow(tenantId, session.userId, id));
    }
  }
  throw new ApiError(404, "Действие радара не найдено", "not_found");
}
