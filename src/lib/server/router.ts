import { Prisma } from "@prisma/client";
import { getSession, clearSessionCookie, assertSameOrigin } from "../auth";
import { json, readJson, toErrorResponse } from "../api";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { can } from "../domain/rbac";
import { rateLimit } from "../rate-limit";
import { mergeSettings } from "../domain/settings";
import { replyProblems } from "../domain/offer";
import { validateWeights } from "../domain/scoring";
import { validateAutomation } from "../domain/automation";
import {
  analysisSchema,
  approveSchema,
  automationSchema,
  batchSearchSchema,
  bulkSchema,
  campaignSchema,
  integrationSchema,
  inviteSchema,
  loginSchema,
  manualOrgSchema,
  messageDraftSchema,
  noteSchema,
  orgPatchSchema,
  publishSchema,
  registerSchema,
  searchSchema,
  siteCreateSchema,
  syncSchema,
  templateSchema,
  agentReplySchema,
  needsLargeConfirm,
} from "../domain/schemas";
import type { AppSession } from "../auth";
import { loginAccount, registerAccount, switchWorkspace, inviteMember, acceptInvite } from "../services/account";
import { listOrganizations, getOrganization, updateOrganization, addNote, removeOrganization, createManual, scoreOrganization, checkWebsite, exportOrganizations, filterOptions, globalSearch, ownedIds } from "../services/organizations";
import { createSearch, refreshParserTask, cancelSearch, syncExisting } from "../services/parser";
import { enqueueAnalysis } from "../services/analysis";
import { createSite, replyToAgent, publicShare, runQa, requestParserAudit, fixSite, approveSite, publishSite, removeSite } from "../services/sites";
import { listOptOuts } from "../services/opt-outs";
import { draftMessage, approveMessage, sendApprovedMessage } from "../services/communications";
import { prepareOffer } from "../services/offers";
import { approveCampaign, createCampaign, previewAudience, setCampaignStatus } from "../services/campaigns";
import { runRule } from "../services/automations";
import { analytics, dashboard } from "../services/analytics";
import { board, createDeal, createTask, listTasks, updateDeal, updateLead } from "../services/crm";
import { checkIntegration, clearIntegration, listIntegrations, saveIntegration } from "../services/integrations";
import { postAgentMessage } from "../services/agent";
import { AGENT_MODELS, agentModelChoice, resolveAgentModel } from "../integrations/openrouter";
import { disableDemo, enableDemo } from "../services/demo";
import { audit, getSettings, memberIds } from "../services/common";
import type { ProviderId } from "../integrations/catalog";
import { requireReady } from "../integrations/config";
import { StudioClient } from "../integrations/studio";
import { PIPELINE } from "../domain/labels";
import { huntRoutes } from "./hunt-routes";
import { sendAlert } from "../services/alerts";
import { z } from "zod";
import { invitationInfo } from "../services/account";
import { linkTelegramToUser, pollTelegramLogin, requestEmailCode, startTelegramLogin, verifyEmailCode } from "../services/auth-flow";
import { accessSettingsView, saveAccessSettings } from "../services/platform";
import {
  adminOverview,
  assertPlatformAdmin,
  changeMembershipRole,
  createInviteLink,
  createTenant,
  createUser,
  deleteUser,
  grantAccess,
  renameTenant,
  revokeAccess,
  revokeInvite,
  testBot,
  updateUser,
} from "../services/admin";

const roleEnum = z.enum(["OWNER", "ADMIN", "MANAGER", "ANALYST", "OPERATOR", "VIEWER"]);
const inviteTokenField = z.string().trim().regex(/^[a-f0-9]{48}$/).optional().nullable();
const emailCodeRequestSchema = z.object({ email: z.string().trim().email().max(160), name: z.string().trim().max(80).optional().nullable(), inviteToken: inviteTokenField });
const emailCodeVerifySchema = z.object({ email: z.string().trim().email().max(160), code: z.string().trim().regex(/^\d{6}$/, "Код — 6 цифр"), inviteToken: inviteTokenField });
const tgStartSchema = z.object({ name: z.string().trim().max(80).optional().nullable(), inviteToken: inviteTokenField });
const tgPollSchema = z.object({ code: z.string().trim().regex(/^[a-f0-9]{32}$/) });

function allow(session: AppSession, permission: string) {
  if (!can(session.role, permission)) throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export async function dispatch(request: Request, path: string[]): Promise<Response> {
  let alertTenant: string | null = null;
  try {
    if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
    const url = new URL(request.url);
    const key = `${request.method} ${path.join("/")}`;

    if (key === "GET health") {
      await prisma.$queryRaw`SELECT 1`;
      return json({ status: "ok" });
    }
    if (key === "POST auth/register") {
      if (!rateLimit(`register:${clientIp(request)}`, 5, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много попыток. Подождите.", "rate_limit");
      const session = await registerAccount(registerSchema.parse(await readJson(request)));
      return json({ user: publicUser(session) }, 201);
    }
    if (key === "POST auth/login") {
      if (!rateLimit(`login:${clientIp(request)}`, 10, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много попыток входа.", "rate_limit");
      const body = loginSchema.parse(await readJson(request));
      const session = await loginAccount(body.email, body.password);
      return json({ user: publicUser(session) });
    }
    // Вход и регистрация без пароля: код на почту или подтверждение в Telegram.
    if (key === "POST auth/email/request") {
      if (!rateLimit(`email-code:${clientIp(request)}`, 10, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много запросов кода. Подождите.", "rate_limit");
      return json(await requestEmailCode(emailCodeRequestSchema.parse(await readJson(request))));
    }
    if (key === "POST auth/email/verify") {
      if (!rateLimit(`email-verify:${clientIp(request)}`, 20, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много попыток. Подождите.", "rate_limit");
      return json(await verifyEmailCode(emailCodeVerifySchema.parse(await readJson(request))));
    }
    if (key === "POST auth/telegram/start") {
      if (!rateLimit(`tg-start:${clientIp(request)}`, 15, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много попыток. Подождите.", "rate_limit");
      return json(await startTelegramLogin(tgStartSchema.parse(await readJson(request))));
    }
    if (key === "POST auth/telegram/poll") {
      if (!rateLimit(`tg-poll:${clientIp(request)}`, 400, 15 * 60 * 1000)) throw new ApiError(429, "Слишком много запросов. Подождите.", "rate_limit");
      return json(await pollTelegramLogin(tgPollSchema.parse(await readJson(request)).code));
    }
    if (request.method === "GET" && path[0] === "auth" && path[1] === "invite" && path[2]) {
      if (!/^[a-f0-9]{48}$/.test(path[2])) throw new ApiError(400, "Ссылка-приглашение повреждена", "invite_invalid");
      return json(await invitationInfo(path[2]));
    }
    if (key === "POST auth/logout") {
      const current = await getSession();
      if (current) await prisma.session.update({ where: { id: current.sessionId }, data: { revokedAt: new Date() } });
      await clearSessionCookie();
      return json({ ok: true });
    }

    const session = await getSession();
    if (!session) throw new ApiError(401, "Войдите в систему", "auth_required");
    alertTenant = session.tenantId;

    if (key === "GET auth/me") return json({ user: publicUser(session), members: await memberIds(session.tenantId) });
    if (key === "POST auth/telegram/link") return json(await linkTelegramToUser(session.userId, tgPollSchema.parse(await readJson(request)).code));
    if (path[0] === "admin") return await adminRoutes(request, session, path);
    if (key === "GET workspaces") {
      const rows = await prisma.membership.findMany({ where: { userId: session.userId }, include: { tenant: true } });
      return json(rows.map((row) => ({ id: row.tenantId, name: row.tenant.name, role: row.role, current: row.tenantId === session.tenantId })));
    }
    if (key === "POST workspaces/switch") {
      const body = (await readJson(request)) as { tenantId?: string };
      if (!body.tenantId) throw new ApiError(400, "Не выбрано пространство", "validation");
      const next = await switchWorkspace(session.userId, body.tenantId);
      return json({ user: publicUser(next) });
    }
    if (key === "GET dashboard") return json(await dashboard(session.tenantId));
    if (key === "GET analytics") {
      allow(session, "analytics.read");
      return json(await analytics(session.tenantId, url.searchParams));
    }
    if (key === "GET search") {
      allow(session, "org.read");
      return json(await globalSearch(session.tenantId, url.searchParams.get("q") || ""));
    }
    if (key === "GET notifications") {
      const rows = await prisma.notification.findMany({ where: { tenantId: session.tenantId, OR: [{ userId: null }, { userId: session.userId }] }, orderBy: { createdAt: "desc" }, take: 30 });
      return json(rows);
    }
    if (key === "POST notifications/read") {
      await prisma.notification.updateMany({ where: { tenantId: session.tenantId, OR: [{ userId: null }, { userId: session.userId }], readAt: null }, data: { readAt: new Date() } });
      return json({ ok: true });
    }
    if (key === "GET settings") {
      allow(session, "settings.manage");
      return json(await getSettings(session.tenantId));
    }
    if (key === "PATCH settings") {
      allow(session, "settings.manage");
      const patch = await readJson(request);
      const next = mergeSettings({
        ...(await getSettings(session.tenantId)),
        ...(patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {}),
      });
      const problem = validateWeights(next.scoreWeights);
      if (problem) throw new ApiError(400, problem, "weights");
      if (next.budgets.dailyUsd < next.budgets.perOperationUsd || next.budgets.monthlyUsd < next.budgets.dailyUsd) {
        throw new ApiError(400, "Месячный лимит не может быть меньше дневного, а дневной — меньше лимита операции", "budget");
      }
      const replyProblem = replyProblems(next.reply);
      if (replyProblem) throw new ApiError(400, replyProblem, "reply");
      await prisma.tenant.update({ where: { id: session.tenantId }, data: { settings: next } });
      await audit({ tenantId: session.tenantId, actorId: session.userId, action: "settings.update" });
      return json(next);
    }
    if (key === "GET audit") {
      allow(session, "audit.read");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const where = { tenantId: session.tenantId };
      const [total, items] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
      ]);
      return json({ total, page, items });
    }
    if (key === "POST demo") {
      allow(session, "settings.manage");
      return json(await enableDemo(session.tenantId));
    }
    if (key === "DELETE demo") {
      allow(session, "settings.manage");
      await disableDemo(session.tenantId);
      return json({ ok: true });
    }

    if (path[0] === "organizations") return await organizations(request, session, path, url);
    if (path[0] === "parser") return await parserRoutes(request, session, path, url);
    if (path[0] === "analysis") return await analysisRoutes(request, session, path);
    if (path[0] === "sites") return await siteRoutes(request, session, path);
    if (path[0] === "crm") return await crmRoutes(request, session, path);
    if (path[0] === "communications") return await communicationRoutes(request, session, path);
    if (path[0] === "opt-outs" && request.method === "GET") {
      allow(session, "comms.read");
      return json(await listOptOuts(session.tenantId));
    }
    if (path[0] === "campaigns") return await campaignRoutes(request, session, path);
    if (path[0] === "automations") return await automationRoutes(request, session, path);
    if (path[0] === "team") return await teamRoutes(request, session, path);
    if (path[0] === "integrations") return await integrationRoutes(request, session, path);
    if (path[0] === "agent") return await agentRoutes(request, session, path);
    if (path[0] === "hunt") return await huntRoutes(request, session, path, url);
    if (path[0] === "jobs" && path[1] && request.method === "GET") {
      const job = await prisma.job.findFirst({ where: { id: path[1], tenantId: session.tenantId } });
      if (!job) throw new ApiError(404, "Задача не найдена", "not_found");
      return json(job);
    }
    throw new ApiError(404, "Раздел не найден", "not_found");
  } catch (error) {
    const response = toErrorResponse(error);
    // Внутренние ошибки (500 и сбои внешних сервисов 502/504) — в Telegram пространства.
    if (alertTenant && response.status >= 500) {
      const where = `${request.method} /api/${path.join("/")}`;
      const message = error instanceof Error ? error.message : String(error);
      await sendAlert(alertTenant, `Ошибка ${response.status} в ${where}`, message, { key: `api:${where}` });
    }
    return response;
  }
}

function publicUser(session: AppSession) {
  return { id: session.userId, email: session.email, name: session.name, role: session.role, tenantId: session.tenantId, tenantName: session.tenantName, isPlatformAdmin: session.isPlatformAdmin };
}

const grantSchema = z.object({ userId: z.string().min(1), tenantId: z.string().min(1), role: roleEnum, notify: z.boolean().optional() });
const userPatchSchema = z.object({
  status: z.enum(["active", "blocked", "pending"]).optional(),
  isPlatformAdmin: z.boolean().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  adminNote: z.string().max(500).nullable().optional(),
  password: z.string().max(200).nullable().optional(),
});
const userCreateSchema = z.object({
  email: z.string().trim().email().max(160),
  name: z.string().trim().min(2).max(80),
  tenantId: z.string().min(1),
  role: roleEnum,
  password: z.string().max(200).optional().nullable(),
  isPlatformAdmin: z.boolean().optional(),
  notify: z.boolean().optional(),
});
const tenantCreateSchema = z.object({ name: z.string().trim().min(2).max(80), ownerUserId: z.string().optional().nullable(), shareFrom: z.string().optional().nullable() });
const adminInviteSchema = z.object({
  tenantId: z.string().min(1),
  role: roleEnum.exclude(["OWNER"]),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
  note: z.string().max(200).optional().nullable(),
  days: z.number().int().min(1).max(30).optional(),
  sendEmail: z.boolean().optional(),
});
const accessSettingsSchema = z.object({
  allowRequests: z.boolean().optional(),
  notifyAdmins: z.boolean().optional(),
  botToken: z.string().max(200).nullable().optional(),
  smtpHost: z.string().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(200).optional(),
  smtpFrom: z.string().max(200).optional(),
  smtpPassword: z.string().max(500).nullable().optional(),
});

async function adminRoutes(request: Request, session: AppSession, path: string[]) {
  assertPlatformAdmin(session);
  const method = request.method;
  const [, section, id, sub] = path;
  if (method === "GET" && section === undefined) return json(await adminOverview());
  if (section === "access-settings" && method === "GET") return json(await accessSettingsView());
  if (section === "access-settings" && method === "PATCH") return json(await saveAccessSettings(accessSettingsSchema.parse(await readJson(request))));
  if (section === "test-bot" && method === "POST") return json(await testBot(session));
  if (section === "memberships" && method === "POST" && !id) return json(await grantAccess(session, grantSchema.parse(await readJson(request))), 201);
  if (section === "memberships" && id && method === "PATCH") return json(await changeMembershipRole(session, id, z.object({ role: roleEnum }).parse(await readJson(request)).role));
  if (section === "memberships" && id && method === "DELETE") return json(await revokeAccess(session, id));
  if (section === "users" && method === "POST" && !id) return json(await createUser(session, userCreateSchema.parse(await readJson(request))), 201);
  if (section === "users" && id && method === "PATCH" && !sub) return json(await updateUser(session, id, userPatchSchema.parse(await readJson(request))));
  if (section === "users" && id && method === "DELETE") return json(await deleteUser(session, id));
  if (section === "tenants" && method === "POST" && !id) return json(await createTenant(session, tenantCreateSchema.parse(await readJson(request))), 201);
  if (section === "tenants" && id && method === "PATCH") return json(await renameTenant(id, z.object({ name: z.string() }).parse(await readJson(request)).name));
  if (section === "invitations" && method === "POST" && !id) {
    const body = adminInviteSchema.parse(await readJson(request));
    return json(await createInviteLink(session, { ...body, email: body.email || null }), 201);
  }
  if (section === "invitations" && id && method === "DELETE") return json(await revokeInvite(id));
  throw new ApiError(404, "Действие админки не найдено", "not_found");
}

async function organizations(request: Request, session: AppSession, path: string[], url: URL) {
  if (path.length === 1 && request.method === "GET") {
    allow(session, "org.read");
    return json(await listOrganizations(session.tenantId, url.searchParams));
  }
  if (path.length === 2 && path[1] === "export" && request.method === "GET") {
    allow(session, "org.read");
    const file = await exportOrganizations(session.tenantId, url.searchParams);
    return new Response(file.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=organizations.csv",
        "X-Total-Count": String(file.total),
        "X-Truncated": String(file.truncated),
      },
    });
  }
  if (path.length === 2 && path[1] === "filters" && request.method === "GET") {
    allow(session, "org.read");
    return json({ ...(await filterOptions(session.tenantId)), members: await memberIds(session.tenantId) });
  }
  if (path.length === 1 && request.method === "POST") {
    allow(session, "org.write");
    const created = await createManual(session.tenantId, manualOrgSchema.parse(await readJson(request)));
    await audit({ tenantId: session.tenantId, actorId: session.userId, action: "organization.create", entityId: created.organization.id });
    return json(created, 201);
  }
  if (path.length === 2 && path[1] === "bulk" && request.method === "POST") {
    const body = bulkSchema.parse(await readJson(request));
    await ownedIds(session.tenantId, body.ids);
    if (body.action === "assign") {
      allow(session, "lead.manage");
      if (!body.assigneeId) throw new ApiError(400, "Выберите сотрудника", "assignee_required");
      if (body.ids.length > 20 && !body.confirmLarge) throw new ApiError(409, "Массовое назначение нужно подтвердить", "confirm_required");
      await prisma.organization.updateMany({ where: { tenantId: session.tenantId, id: { in: body.ids } }, data: { assigneeId: body.assigneeId } });
      return json({ updated: body.ids.length });
    }
    if (body.action === "score") {
      allow(session, "analysis.manage");
      const scores = [];
      for (const id of body.ids) scores.push({ id, ...(await scoreOrganization(session.tenantId, id)) });
      return json({ scores });
    }
    if (body.action === "analyze") {
      allow(session, "analysis.manage");
      return json(await enqueueAnalysis(session.tenantId, session.userId, body.ids, body.confirmLarge));
    }
    allow(session, "sites.manage");
    if (body.ids.length > 3 && !body.confirmLarge) throw new ApiError(409, "Создание нескольких демо нужно подтвердить", "confirm_required");
    const projects = [];
    for (const id of body.ids) {
      projects.push(await createSite(session.tenantId, session.userId, { organizationId: id, siteType: body.siteType || "services", language: "ru", pages: [], confirm: true }));
    }
    return json({ projects });
  }
  const id = path[1];
  if (!id) throw new ApiError(404, "Организация не найдена", "not_found");
  if (path.length === 2 && request.method === "GET") {
    allow(session, "org.read");
    return json(await getOrganization(session.tenantId, id));
  }
  if (path.length === 2 && request.method === "PATCH") {
    allow(session, "org.write");
    return json(await updateOrganization(session.tenantId, id, orgPatchSchema.parse(await readJson(request)), session.userId));
  }
  if (path.length === 2 && request.method === "DELETE") {
    allow(session, "org.delete");
    const body = (await readJson(request)) as { confirm?: boolean };
    if (body.confirm !== true) throw new ApiError(409, "Удаление нужно подтвердить", "confirm_required");
    await removeOrganization(session.tenantId, id);
    await audit({ tenantId: session.tenantId, actorId: session.userId, action: "organization.delete", entityId: id });
    return json({ ok: true });
  }
  if (path[2] === "notes" && request.method === "POST") {
    allow(session, "org.write");
    return json(await addNote(session.tenantId, id, session.userId, noteSchema.parse(await readJson(request)).body), 201);
  }
  if (path[2] === "check-website" && request.method === "POST") {
    allow(session, "org.write");
    return json(await checkWebsite(session.tenantId, id, session.userId));
  }
  if (path[2] === "offer" && request.method === "POST") {
    allow(session, "comms.manage");
    const raw = await request.text();
    let format: "compact" | "extended" | "followup" = "compact";
    if (raw.trim()) {
      const body = JSON.parse(raw) as { format?: string };
      if (body.format === "extended" || body.format === "followup" || body.format === "compact") format = body.format;
    }
    return json(await prepareOffer(session.tenantId, session.userId, id, format));
  }
  throw new ApiError(404, "Действие не найдено", "not_found");
}

async function parserRoutes(request: Request, session: AppSession, path: string[], url: URL) {
  allow(session, path.length === 2 && path[1] === "tasks" && request.method === "GET" ? "org.read" : "search.manage");
  if (path[1] === "tasks" && path.length === 2 && request.method === "GET") {
    const items = await prisma.parserTask.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
    return json(items);
  }
  if (path[1] === "tasks" && path.length === 2 && request.method === "POST") {
    const input = searchSchema.parse(await readJson(request));
    return json(await createSearch(session.tenantId, session.userId, input), 201);
  }
  if (path[1] === "tasks" && path[2] === "batch" && request.method === "POST") {
    const input = batchSearchSchema.parse(await readJson(request));
    if (needsLargeConfirm(input.maxResults, input.cities.length) && !input.confirmLarge) {
      throw new ApiError(409, "Пакетный поиск нужно подтвердить.", "confirm_required");
    }
    const tasks = [];
    for (const city of input.cities) {
      tasks.push(await createSearch(session.tenantId, session.userId, { ...input, city, confirmLarge: true }));
    }
    return json({ tasks }, 201);
  }
  if (path[1] === "tasks" && path[2] && path[3] === "events" && request.method === "GET") return taskEvents(session.tenantId, path[2], request);
  if (path[1] === "tasks" && path[2] && path.length === 3 && request.method === "GET") return json(await refreshParserTask(session.tenantId, path[2]));
  if (path[1] === "tasks" && path[2] && path[3] === "cancel" && request.method === "POST") return json(await cancelSearch(session.tenantId, path[2], session.userId));
  if (path[1] === "sync" && request.method === "POST") return json(await syncExisting(session.tenantId, session.userId, syncSchema.parse(await readJson(request))), 201);
  if (path[1] === "templates" && request.method === "GET") {
    return json(await prisma.searchTemplate.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" } }));
  }
  if (path[1] === "templates" && request.method === "POST") {
    const body = templateSchema.parse(await readJson(request));
    return json(await prisma.searchTemplate.create({ data: { tenantId: session.tenantId, name: body.name, params: body.params as Prisma.InputJsonValue, createdById: session.userId } }), 201);
  }
  if (path[1] === "templates" && path[2] && request.method === "DELETE") {
    await prisma.searchTemplate.deleteMany({ where: { id: path[2], tenantId: session.tenantId } });
    return json({ ok: true });
  }
  if (path[1] === "runs" && request.method === "GET") {
    return json(await prisma.syncRun.findMany({ where: { tenantId: session.tenantId }, orderBy: { startedAt: "desc" }, take: 20 }));
  }
  throw new ApiError(404, "Действие парсера не найдено", "not_found");
}

function taskEvents(tenantId: string, id: string, request: Request) {
  const encoder = new TextEncoder();
  let timer: NodeJS.Timeout;
  let ping: NodeJS.Timeout;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(ping);
        controller.close();
      };
      const tick = async () => {
        try {
          const task = await refreshParserTask(tenantId, id);
          send("task", task);
          if (["failed", "cancelled"].includes(task.status) || (task.status === "completed" && task.syncedAt)) {
            send("end", { status: task.status });
            cleanup();
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "Не удалось обновить задачу" });
        }
      };
      timer = setInterval(() => void tick(), 4000);
      ping = setInterval(() => send("ping", { ok: true }), 15000);
      request.signal.addEventListener("abort", cleanup);
      void tick();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

async function analysisRoutes(request: Request, session: AppSession, path: string[]) {
  if (request.method === "GET" && path.length === 1) {
    allow(session, "analysis.read");
    return json(await prisma.analysisReport.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" }, take: 100, include: { organization: { select: { name: true, city: true, isDemo: true } } } }));
  }
  if (request.method === "POST" && path.length === 1) {
    allow(session, "analysis.manage");
    const body = analysisSchema.parse(await readJson(request));
    return json(await enqueueAnalysis(session.tenantId, session.userId, body.organizationIds, body.confirmLarge), 202);
  }
  if (request.method === "GET" && path[1]) {
    allow(session, "analysis.read");
    const report = await prisma.analysisReport.findFirst({ where: { id: path[1], tenantId: session.tenantId }, include: { organization: true } });
    if (!report) throw new ApiError(404, "Отчёт не найден", "not_found");
    return json(report);
  }
  throw new ApiError(404, "Действие анализа не найдено", "not_found");
}

async function siteRoutes(request: Request, session: AppSession, path: string[]) {
  if (path.length === 1 && request.method === "GET") {
    allow(session, "sites.read");
    const status = new URL(request.url).searchParams.get("status");
    return json(await prisma.siteProject.findMany({
      where: { tenantId: session.tenantId, ...(status ? { status } : {}) },
      include: { organization: { select: { name: true, city: true, isDemo: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }));
  }
  if (path.length === 1 && request.method === "POST") {
    allow(session, "sites.manage");
    const body = siteCreateSchema.parse(await readJson(request));
    return json(await createSite(session.tenantId, session.userId, body), 202);
  }
  const id = path[1];
  if (!id) throw new ApiError(404, "Проект не найден", "not_found");
  const project = async () => {
    const row = await prisma.siteProject.findFirst({ where: { id, tenantId: session.tenantId }, include: { runs: { orderBy: { createdAt: "desc" } }, audits: { orderBy: { createdAt: "desc" } }, versions: true, approvals: true, organization: true } });
    if (!row) throw new ApiError(404, "Проект не найден", "not_found");
    return row;
  };
  if (path.length === 2 && request.method === "GET") {
    allow(session, "sites.read");
    return json(await project());
  }
  if (path[2] === "reply" && request.method === "POST") {
    allow(session, "sites.manage");
    return json(await replyToAgent(session.tenantId, session.userId, id, agentReplySchema.parse(await readJson(request)).text));
  }
  if (path[2] === "preview" && request.method === "POST") {
    allow(session, "sites.read");
    return json(await publicShare(session.tenantId, session.userId, id));
  }
  if (path[2] === "thumbnail" && request.method === "GET") {
    allow(session, "sites.read");
    const row = await project();
    if (!row.studioProjectId) throw new ApiError(409, "Миниатюра появится после создания проекта в Studio", "not_ready");
    const integration = await requireReady(session.tenantId, "studio", "Миниатюра");
    const bytes = await new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey).thumbnail(row.studioProjectId);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" } });
  }
  if (path[2] === "qa" && request.method === "POST") {
    allow(session, "qa.manage");
    return json(await runQa(session.tenantId, session.userId, id));
  }
  if (path[2] === "audit" && request.method === "POST") {
    allow(session, "qa.manage");
    return json(await requestParserAudit(session.tenantId, session.userId, id), 202);
  }
  if (path[2] === "fix" && request.method === "POST") {
    allow(session, "sites.manage");
    return json(await fixSite(session.tenantId, session.userId, id));
  }
  if (path[2] === "approve" && request.method === "POST") {
    allow(session, "sites.manage");
    const body = (await readJson(request)) as { comment?: string };
    return json(await approveSite(session.tenantId, session.userId, id, body.comment));
  }
  if (path[2] === "publish" && request.method === "POST") {
    allow(session, "sites.publish");
    const body = publishSchema.parse(await readJson(request));
    return json(await publishSite(session.tenantId, session.userId, id, body.visibility));
  }
  if (path[2] === "versions" && request.method === "GET") {
    allow(session, "sites.read");
    const row = await project();
    if (!row.studioProjectId) return json({ versions: row.versions, studio: null });
    const integration = await requireReady(session.tenantId, "studio", "Версии");
    const remote = await new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey).versions(row.studioProjectId);
    return json({ local: row.versions, studio: remote.body });
  }
  if (path[2] === "checkpoint" && request.method === "POST") {
    allow(session, "sites.manage");
    const row = await project();
    if (!row.studioProjectId) throw new ApiError(409, "Проект Studio ещё не создан", "not_ready");
    const integration = await requireReady(session.tenantId, "studio", "Версия");
    const body = (await readJson(request)) as { message?: string };
    const saved = await new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey).checkpoint(row.studioProjectId, body.message || "Версия из LeadFlow");
    await prisma.siteVersion.create({ data: { siteProjectId: row.id, message: body.message || "Версия из LeadFlow" } });
    return json(saved.body);
  }
  if (path[2] === "restore" && request.method === "POST") {
    allow(session, "sites.manage");
    const body = (await readJson(request)) as { sha?: string; confirm?: boolean };
    if (body.confirm !== true || !body.sha) throw new ApiError(409, "Откат нужно подтвердить и указать версию", "confirm_required");
    const row = await project();
    if (!row.studioProjectId) throw new ApiError(409, "Проект Studio ещё не создан", "not_ready");
    const integration = await requireReady(session.tenantId, "studio", "Откат");
    const restored = await new StudioClient(String(integration.config.baseUrl), integration.secrets.apiKey).restore(row.studioProjectId, body.sha);
    return json(restored.body);
  }
  if (path.length === 2 && request.method === "DELETE") {
    allow(session, "sites.publish");
    const body = (await readJson(request)) as { confirm?: boolean };
    if (body.confirm !== true) throw new ApiError(409, "Удаление проекта нужно подтвердить", "confirm_required");
    await removeSite(session.tenantId, session.userId, id);
    return json({ ok: true });
  }
  throw new ApiError(404, "Действие с сайтом не найдено", "not_found");
}

async function crmRoutes(request: Request, session: AppSession, path: string[]) {
  const write = request.method !== "GET";
  if (path[1] === "tasks") {
    if (!can(session.role, "crm.manage") && !can(session.role, "crm.read") && !can(session.role, "task.own")) {
      throw new ApiError(403, "Недостаточно прав для этого действия", "forbidden");
    }
  } else {
    allow(session, write ? "crm.manage" : "crm.read");
  }
  if (path[1] === "board" && request.method === "GET") return json(await board(session.tenantId));
  if (path[1] === "leads" && request.method === "GET") {
    const leads = await prisma.lead.findMany({
      where: { tenantId: session.tenantId, organization: { isDemo: false } },
      include: { organization: true, stage: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return json(leads);
  }
  if (path[1] === "leads" && path[2] && request.method === "PATCH") {
    allow(session, "lead.manage");
    return json(await updateLead(session.tenantId, path[2], session.userId, await readJson(request)));
  }
  if (path[1] === "deals" && request.method === "GET") return json(await prisma.deal.findMany({ where: { tenantId: session.tenantId }, include: { organization: true, stage: true }, orderBy: { updatedAt: "desc" } }));
  if (path[1] === "deals" && request.method === "POST") return json(await createDeal(session.tenantId, session.userId, await readJson(request)), 201);
  if (path[1] === "deals" && path[2] && request.method === "PATCH") return json(await updateDeal(session.tenantId, path[2], session.userId, await readJson(request)));
  if (path[1] === "tasks" && request.method === "GET") return json(await listTasks(session.tenantId, session.userId, session.role));
  if (path[1] === "tasks" && request.method === "POST") return json(await createTask(session.tenantId, session.userId, await readJson(request)), 201);
  if (path[1] === "tasks" && path[2] && request.method === "PATCH") {
    const body = (await readJson(request)) as { status?: string; assigneeId?: string | null };
    if (session.role === "OPERATOR") allow(session, "task.own");
    const task = await prisma.crmTask.findFirst({ where: { id: path[2], tenantId: session.tenantId } });
    if (!task) throw new ApiError(404, "Задача не найдена", "not_found");
    if (session.role === "OPERATOR" && task.assigneeId !== session.userId) throw new ApiError(403, "Можно менять только свои задачи", "forbidden");
    return json(await prisma.crmTask.update({ where: { id: task.id }, data: { status: body.status, assigneeId: body.assigneeId === undefined ? undefined : body.assigneeId } }));
  }
  if (path[1] === "stages" && request.method === "GET") return json(await prisma.pipelineStage.findMany({ where: { tenantId: session.tenantId }, orderBy: { position: "asc" } }));
  if (path[1] === "stages" && request.method === "POST") {
    allow(session, "settings.manage");
    const body = (await readJson(request)) as { key?: string; name?: string };
    if (!body.key || !body.name) throw new ApiError(400, "Нужны ключ и название стадии", "validation");
    const position = await prisma.pipelineStage.count({ where: { tenantId: session.tenantId } });
    return json(await prisma.pipelineStage.create({ data: { tenantId: session.tenantId, key: body.key, name: body.name, position } }), 201);
  }
  if (path[1] === "stages" && path[2] && request.method === "PATCH") {
    allow(session, "settings.manage");
    const body = (await readJson(request)) as { name?: string; position?: number };
    const stage = await prisma.pipelineStage.findFirst({ where: { id: path[2], tenantId: session.tenantId } });
    if (!stage) throw new ApiError(404, "Стадия не найдена", "not_found");
    return json(await prisma.pipelineStage.update({ where: { id: stage.id }, data: { name: body.name, position: body.position } }));
  }
  if (path[1] === "stages" && path[2] && request.method === "DELETE") {
    allow(session, "settings.manage");
    const stage = await prisma.pipelineStage.findFirst({ where: { id: path[2], tenantId: session.tenantId } });
    if (!stage) throw new ApiError(404, "Стадия не найдена", "not_found");
    if (PIPELINE.some((item) => item.key === stage.key)) throw new ApiError(409, "Базовую стадию удалять нельзя. Её можно переименовать.", "stage_locked");
    const used = await prisma.lead.count({ where: { stageId: stage.id } });
    if (used) throw new ApiError(409, "На стадии есть лиды", "stage_used");
    await prisma.pipelineStage.delete({ where: { id: stage.id } });
    return json({ ok: true });
  }
  throw new ApiError(404, "Действие CRM не найдено", "not_found");
}

async function communicationRoutes(request: Request, session: AppSession, path: string[]) {
  allow(session, request.method === "GET" ? "comms.read" : "comms.manage");
  if (path[1] === "conversations" && request.method === "GET" && path.length === 2) {
    return json(await prisma.conversation.findMany({ where: { tenantId: session.tenantId }, include: { organization: true, messages: { take: 1, orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" }, take: 100 }));
  }
  if (path[1] === "conversations" && path[2] && request.method === "GET") {
    const row = await prisma.conversation.findFirst({ where: { id: path[2], tenantId: session.tenantId }, include: { messages: { orderBy: { createdAt: "asc" } }, organization: true } });
    if (!row) throw new ApiError(404, "Диалог не найден", "not_found");
    return json(row);
  }
  if (path[1] === "messages" && request.method === "POST") {
    return json(await draftMessage(session.tenantId, session.userId, messageDraftSchema.parse(await readJson(request))), 201);
  }
  if (path[1] === "messages" && path[2] && path[3] === "approve" && request.method === "POST") {
    const body = approveSchema.parse(await readJson(request));
    return json(await approveMessage(session.tenantId, session.userId, path[2], body.lawfulBasis, body.basisNote));
  }
  if (path[1] === "messages" && path[2] && path[3] === "send" && request.method === "POST") {
    return json(await sendApprovedMessage(session.tenantId, path[2], session.userId));
  }
  if (path[1] === "templates" && request.method === "GET") return json(await prisma.messageTemplate.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" } }));
  if (path[1] === "templates" && request.method === "POST") {
    const body = (await readJson(request)) as { name?: string; channel?: string; body?: string };
    if (!body.name || !body.channel || !body.body) throw new ApiError(400, "Заполните название, канал и текст", "validation");
    return json(await prisma.messageTemplate.create({ data: { tenantId: session.tenantId, name: body.name, channel: body.channel, body: body.body } }), 201);
  }
  if (path[1] === "templates" && path[2] && request.method === "DELETE") {
    await prisma.messageTemplate.deleteMany({ where: { id: path[2], tenantId: session.tenantId } });
    return json({ ok: true });
  }
  if (path[1] === "suppression" && request.method === "GET") return json(await prisma.suppressionEntry.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" } }));
  if (path[1] === "suppression" && request.method === "POST") {
    const body = (await readJson(request)) as { value?: string; reason?: string; channel?: string };
    if (!body.value || !body.reason) throw new ApiError(400, "Укажите контакт и причину отказа", "validation");
    return json(await prisma.suppressionEntry.upsert({
      where: { tenantId_channel_value: { tenantId: session.tenantId, channel: body.channel || "*", value: body.value.toLowerCase() } },
      update: { reason: body.reason },
      create: { tenantId: session.tenantId, channel: body.channel || "*", value: body.value.toLowerCase(), reason: body.reason },
    }), 201);
  }
  if (path[1] === "suppression" && path[2] && request.method === "DELETE") {
    await prisma.suppressionEntry.deleteMany({ where: { id: path[2], tenantId: session.tenantId } });
    return json({ ok: true });
  }
  if (path[1] === "consent" && request.method === "POST") {
    const input = approveSchema.parse(await readJson(request));
    const organizationId = (input as { organizationId?: string }).organizationId;
    return json(await prisma.consentRecord.create({ data: { tenantId: session.tenantId, organizationId, basis: input.lawfulBasis, note: input.basisNote, recordedById: session.userId } }), 201);
  }
  throw new ApiError(404, "Действие коммуникаций не найдено", "not_found");
}

async function campaignRoutes(request: Request, session: AppSession, path: string[]) {
  allow(session, request.method === "GET" ? "comms.read" : "campaigns.manage");
  if (path.length === 1 && request.method === "GET") return json(await prisma.campaign.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" } }));
  if (path.length === 1 && request.method === "POST") {
    const body = campaignSchema.parse(await readJson(request));
    return json(await createCampaign(session.tenantId, session.userId, body), 201);
  }
  if (path[1] === "preview" && request.method === "POST") {
    const body = (await readJson(request)) as { filters?: Record<string, unknown>; channel?: string };
    return json(await previewAudience(session.tenantId, body.filters ?? {}, body.channel || "test"));
  }
  if (path[1] && path.length === 2 && request.method === "GET") {
    const campaign = await prisma.campaign.findFirst({ where: { id: path[1], tenantId: session.tenantId }, include: { recipients: true } });
    if (!campaign) throw new ApiError(404, "Кампания не найдена", "not_found");
    return json(campaign);
  }
  if (path[2] === "preview" && request.method === "POST") {
    const body = (await readJson(request)) as { filters?: Record<string, unknown>; channel?: string };
    return json(await previewAudience(session.tenantId, body.filters ?? {}, body.channel || "test"));
  }
  if (path[2] === "approve" && request.method === "POST") {
    allow(session, "campaigns.approve");
    const body = approveSchema.parse(await readJson(request));
    return json(await approveCampaign(session.tenantId, session.userId, path[1], body.lawfulBasis, body.basisNote));
  }
  if (path[2] === "start" && request.method === "POST") return json(await setCampaignStatus(session.tenantId, path[1], "running"));
  if (path[2] === "pause" && request.method === "POST") return json(await setCampaignStatus(session.tenantId, path[1], "paused"));
  if (path[2] === "cancel" && request.method === "POST") return json(await setCampaignStatus(session.tenantId, path[1], "cancelled"));
  throw new ApiError(404, "Действие кампании не найдено", "not_found");
}

async function automationRoutes(request: Request, session: AppSession, path: string[]) {
  allow(session, "automations.manage");
  if (path.length === 1 && request.method === "GET") return json(await prisma.automationRule.findMany({ where: { tenantId: session.tenantId }, orderBy: { createdAt: "desc" } }));
  if (path.length === 1 && request.method === "POST") {
    const body = automationSchema.parse(await readJson(request));
    const problem = validateAutomation(body);
    if (problem) throw new ApiError(400, problem, "automation");
    return json(await prisma.automationRule.create({
      data: {
        tenantId: session.tenantId,
        name: body.name,
        description: body.description,
        active: body.active,
        trigger: body.trigger,
        conditions: body.conditions as Prisma.InputJsonValue,
        actions: body.actions as Prisma.InputJsonValue,
        intervalMinutes: body.intervalMinutes ?? null,
      },
    }), 201);
  }
  if (path[1] && request.method === "PATCH" && path.length === 2) {
    const current = await prisma.automationRule.findFirst({ where: { id: path[1], tenantId: session.tenantId } });
    if (!current) throw new ApiError(404, "Правило не найдено", "not_found");
    const body = (await readJson(request)) as { active?: boolean; name?: string };
    return json(await prisma.automationRule.update({ where: { id: current.id }, data: { active: body.active, name: body.name } }));
  }
  if (path[1] && request.method === "DELETE") {
    await prisma.automationRule.deleteMany({ where: { id: path[1], tenantId: session.tenantId } });
    return json({ ok: true });
  }
  if (path[2] === "dry-run" && request.method === "POST") {
    const body = (await readJson(request)) as { payload?: Record<string, unknown> };
    const rule = await prisma.automationRule.findFirst({ where: { id: path[1], tenantId: session.tenantId }, select: { id: true } });
    if (!rule) throw new ApiError(404, "Правило не найдено", "not_found");
    await runRule(path[1], body.payload ?? {}, true, session.tenantId);
    const runs = await prisma.automationRun.findMany({ where: { ruleId: path[1], tenantId: session.tenantId }, orderBy: { startedAt: "desc" }, take: 1 });
    return json(runs[0] ?? null);
  }
  if (path[2] === "runs" && request.method === "GET") {
    return json(await prisma.automationRun.findMany({ where: { ruleId: path[1], tenantId: session.tenantId }, orderBy: { startedAt: "desc" }, take: 50 }));
  }
  if (path[2] === "stop" && request.method === "POST") {
    return json(await prisma.automationRule.updateMany({ where: { id: path[1], tenantId: session.tenantId }, data: { active: false } }));
  }
  throw new ApiError(404, "Действие автоматизации не найдено", "not_found");
}

async function teamRoutes(request: Request, session: AppSession, path: string[]) {
  if (request.method === "GET" && path.length === 1) {
    allow(session, "team.manage");
    const invitations = await prisma.invitation.findMany({ where: { tenantId: session.tenantId, acceptedAt: null }, orderBy: { createdAt: "desc" } });
    return json({ members: await memberIds(session.tenantId), invitations: invitations.map((item) => ({ id: item.id, email: item.email, role: item.role, expiresAt: item.expiresAt })) });
  }
  if (path[1] === "invitations" && request.method === "POST" && path.length === 2) {
    allow(session, "team.manage");
    const body = inviteSchema.parse(await readJson(request));
    if (session.role !== "OWNER" && body.role === "ADMIN") throw new ApiError(403, "Администратора может пригласить владелец", "forbidden");
    return json(await inviteMember(session.tenantId, body.email, body.role), 201);
  }
  if (path[1] === "invitations" && path[2] === "accept" && request.method === "POST") {
    const body = (await readJson(request)) as { token?: string };
    if (!body.token) throw new ApiError(400, "Нет кода приглашения", "validation");
    const next = await acceptInvite(session.userId, body.token);
    return json({ user: publicUser(next) });
  }
  if (path[1] && request.method === "PATCH") {
    allow(session, "team.manage");
    const body = (await readJson(request)) as { role?: "ADMIN" | "MANAGER" | "ANALYST" | "OPERATOR" | "VIEWER" };
    const membership = await prisma.membership.findFirst({ where: { id: path[1], tenantId: session.tenantId } });
    if (!membership) throw new ApiError(404, "Участник не найден", "not_found");
    if (membership.role === "OWNER" || body.role === undefined) throw new ApiError(403, "Роль владельца здесь не меняется", "owner_locked");
    if (session.role !== "OWNER" && body.role === "ADMIN") throw new ApiError(403, "Назначать администратора может владелец", "forbidden");
    return json(await prisma.membership.update({ where: { id: membership.id }, data: { role: body.role } }));
  }
  if (path[1] && request.method === "DELETE") {
    allow(session, "team.manage");
    const membership = await prisma.membership.findFirst({ where: { id: path[1], tenantId: session.tenantId } });
    if (!membership) throw new ApiError(404, "Участник не найден", "not_found");
    if (membership.role === "OWNER") throw new ApiError(403, "Владельца нельзя удалить этой кнопкой", "owner_locked");
    await prisma.membership.delete({ where: { id: membership.id } });
    return json({ ok: true });
  }
  throw new ApiError(404, "Действие команды не найдено", "not_found");
}

async function integrationRoutes(request: Request, session: AppSession, path: string[]) {
  if (request.method === "GET" && path.length === 1) {
    allow(session, "integrations.manage");
    return json(await listIntegrations(session.tenantId));
  }
  const provider = path[1] as ProviderId;
  if (!provider) throw new ApiError(404, "Интеграция не найдена", "not_found");
  allow(session, "integrations.manage");
  if (request.method === "PUT" && path.length === 2) {
    const body = integrationSchema.parse(await readJson(request));
    return json(await saveIntegration(session.tenantId, session.userId, provider, body.config, body.secrets));
  }
  if (path[2] === "test" && request.method === "POST") return json(await checkIntegration(session.tenantId, session.userId, provider));
  if (request.method === "DELETE" && path.length === 2) {
    await clearIntegration(session.tenantId, session.userId, provider);
    return json({ ok: true });
  }
  throw new ApiError(404, "Действие интеграции не найдено", "not_found");
}

async function agentRoutes(request: Request, session: AppSession, path: string[]) {
  allow(session, "agent.use");
  if (request.method === "GET" && path.length === 1) {
    const settings = await getSettings(session.tenantId);
    const selected = agentModelChoice(settings.ai.agentModel) ?? AGENT_MODELS[0];
    const threads = await prisma.agentThread.findMany({ where: { tenantId: session.tenantId }, orderBy: { updatedAt: "desc" }, take: 40 });
    return json({ model: resolveAgentModel(settings.ai.agentModel), selected: selected.id, models: AGENT_MODELS, threads });
  }
  if (request.method === "POST" && path[1] === "model") {
    const body = (await readJson(request)) as { id?: string };
    const selected = AGENT_MODELS.find((item) => item.id === String(body.id || ""));
    if (!selected) throw new ApiError(422, "Такой модели нет в списке.", "bad_model");
    const settings = await getSettings(session.tenantId);
    const next = { ...settings, ai: { ...settings.ai, agentModel: selected.id } };
    await prisma.tenant.update({ where: { id: session.tenantId }, data: { settings: next } });
    await audit({ tenantId: session.tenantId, actorId: session.userId, action: "settings.update", meta: { agentModel: selected.id } });
    return json({ id: selected.id, model: selected.slug });
  }
  if (request.method === "POST" && path.length === 1) {
    const thread = await prisma.agentThread.create({ data: { tenantId: session.tenantId, userId: session.userId } });
    return json(thread);
  }
  if (request.method === "GET" && path[1]) {
    const thread = await prisma.agentThread.findFirst({
      where: { id: path[1], tenantId: session.tenantId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!thread) throw new ApiError(404, "Диалог не найден", "not_found");
    if (thread.status === "running" && Date.now() - thread.updatedAt.getTime() > 8 * 60 * 1000) {
      const failed = await prisma.agentThread.update({ where: { id: thread.id }, data: { status: "failed", error: "Ход прервался. Напишите задание ещё раз." }, include: { messages: { orderBy: { createdAt: "asc" } } } });
      return json(failed);
    }
    return json(thread);
  }
  if (request.method === "POST" && path[1] && path[2] === "messages") {
    const body = (await readJson(request)) as { text?: string };
    return json(await postAgentMessage(session.tenantId, session.userId, path[1], String(body.text || "")));
  }
  throw new ApiError(404, "Действие агента не найдено", "not_found");
}
