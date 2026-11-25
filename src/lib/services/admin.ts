import "server-only";
import { randomBytes } from "crypto";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { hashPassword, isPlatformAdminUser, type AppSession } from "../auth";
import { ROLE_LABEL } from "../domain/labels";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { logEvent } from "../log";
import { audit, ensureStages } from "./common";
import { inviteMember } from "./account";
import { notifyAccessGranted } from "./auth-flow";
import { appUrl, contactLabel, isServiceEmail, notifyTelegram, sendPlatformMail } from "./platform";

/** Админка платформы: люди, пространства (аккаунты), доступы и ссылки-приглашения во все пространства. */

export function assertPlatformAdmin(session: AppSession) {
  if (!session.isPlatformAdmin) throw new ApiError(403, "Админка доступна только администратору платформы", "forbidden");
}

export async function adminOverview() {
  const [users, tenants, invitations] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { memberships: { include: { tenant: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } } },
    }),
    prisma.tenant.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { memberships: true, organizations: true } } } }),
    prisma.invitation.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, include: { tenant: { select: { name: true } } } }),
  ]);
  return {
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: isServiceEmail(user.email) ? null : user.email,
      contact: contactLabel(user),
      telegramUsername: user.telegramUsername,
      hasTelegram: Boolean(user.telegramId),
      hasPassword: user.passwordHash.startsWith("$2"),
      status: user.status,
      isPlatformAdmin: isPlatformAdminUser(user),
      adminNote: user.adminNote,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      memberships: user.memberships.map((item) => ({ id: item.id, tenantId: item.tenantId, tenantName: item.tenant.name, role: item.role })),
    })),
    tenants: tenants.map((tenant) => ({ id: tenant.id, name: tenant.name, createdAt: tenant.createdAt, members: tenant._count.memberships, organizations: tenant._count.organizations })),
    invitations: invitations.map((item) => ({ id: item.id, tenantId: item.tenantId, tenantName: item.tenant.name, email: item.email, role: item.role, note: item.note, expiresAt: item.expiresAt, createdAt: item.createdAt })),
  };
}

async function tenantOrThrow(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new ApiError(404, "Пространство не найдено", "not_found");
  return tenant;
}

async function ownersLeft(tenantId: string, exceptMembershipId: string) {
  return prisma.membership.count({ where: { tenantId, role: "OWNER", id: { not: exceptMembershipId } } });
}

/** Дать человеку доступ к пространству с ролью (или поменять роль, если доступ уже есть). */
export async function grantAccess(actor: AppSession, input: { userId: string; tenantId: string; role: Role; notify?: boolean }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new ApiError(404, "Пользователь не найден", "not_found");
  const tenant = await tenantOrThrow(input.tenantId);
  const existing = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } });
  if (existing?.role === "OWNER" && input.role !== "OWNER" && !(await ownersLeft(tenant.id, existing.id))) {
    throw new ApiError(409, "Это единственный владелец пространства. Сначала назначьте другого владельца.", "last_owner");
  }
  const membership = await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: { role: input.role },
    create: { tenantId: tenant.id, userId: user.id, role: input.role },
  });
  if (user.status === "pending") await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
  await audit({ tenantId: tenant.id, actorId: actor.userId, action: existing ? "admin.role_change" : "admin.access_grant", entityType: "user", entityId: user.id, meta: { role: input.role } });
  if (!existing && input.notify !== false) await notifyAccessGranted(user.id, tenant.name, ROLE_LABEL[input.role] ?? input.role);
  return membership;
}

/**
 * Создать человека вручную — единственный путь появления новых пользователей при закрытой регистрации.
 * Без пароля он входит по коду на почту; с паролем — ещё и паролем.
 */
export async function createUser(
  actor: AppSession,
  input: { email: string; name: string; tenantId: string; role: Role; password?: string | null; isPlatformAdmin?: boolean; notify?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  if (isServiceEmail(email)) throw new ApiError(400, "Этот адрес служебный — укажите настоящую почту", "validation");
  if (await prisma.user.findUnique({ where: { email } })) throw new ApiError(409, "Пользователь с такой почтой уже есть", "email_taken");
  const tenant = await tenantOrThrow(input.tenantId);
  const password = input.password?.trim();
  if (password && password.length < 8) throw new ApiError(400, "Пароль — не короче 8 символов", "weak_password");
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: password ? await hashPassword(password) : `!nopass:${randomBytes(8).toString("hex")}`,
      status: "active",
      isPlatformAdmin: Boolean(input.isPlatformAdmin),
    },
  });
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: input.role } });
  await audit({ tenantId: tenant.id, actorId: actor.userId, action: "admin.user_create", entityType: "user", entityId: user.id, meta: { role: input.role } });
  if (input.notify !== false) {
    const text = `Для вас создан доступ в LeadFlow.\nПространство: «${tenant.name}», роль: ${ROLE_LABEL[input.role] ?? input.role}.\n\nВойти: ${appUrl()}/login — введите эту почту и код из письма.`;
    await sendPlatformMail(email, "Доступ в LeadFlow", text).catch((error) => logEvent("admin.user_create_mail_failed", { error: error instanceof Error ? error.message : String(error) }, "warn"));
  }
  return { id: user.id };
}

export async function changeMembershipRole(actor: AppSession, membershipId: string, role: Role) {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new ApiError(404, "Доступ не найден", "not_found");
  return grantAccess(actor, { userId: membership.userId, tenantId: membership.tenantId, role, notify: false });
}

export async function revokeAccess(actor: AppSession, membershipId: string) {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new ApiError(404, "Доступ не найден", "not_found");
  if (membership.role === "OWNER" && !(await ownersLeft(membership.tenantId, membership.id))) {
    throw new ApiError(409, "Нельзя убрать единственного владельца пространства.", "last_owner");
  }
  await prisma.membership.delete({ where: { id: membership.id } });
  // Сессии, открытые в этом пространстве, больше не действуют.
  await prisma.session.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  const left = await prisma.membership.count({ where: { userId: membership.userId } });
  if (!left) await prisma.user.update({ where: { id: membership.userId }, data: { status: "pending" } });
  await audit({ tenantId: membership.tenantId, actorId: actor.userId, action: "admin.access_revoke", entityType: "user", entityId: membership.userId });
  return { ok: true };
}

export async function updateUser(actor: AppSession, userId: string, patch: { status?: string; isPlatformAdmin?: boolean; name?: string; adminNote?: string | null; password?: string | null }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Пользователь не найден", "not_found");
  const self = user.id === actor.userId;
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!["active", "blocked", "pending"].includes(patch.status)) throw new ApiError(400, "Неизвестный статус", "validation");
    if (self && patch.status === "blocked") throw new ApiError(400, "Себя заблокировать нельзя", "self");
    data.status = patch.status;
  }
  if (patch.isPlatformAdmin !== undefined) {
    if (self && !patch.isPlatformAdmin) throw new ApiError(400, "Нельзя снять права администратора с самого себя", "self");
    data.isPlatformAdmin = patch.isPlatformAdmin;
  }
  if (typeof patch.name === "string" && patch.name.trim().length >= 2) data.name = patch.name.trim().slice(0, 80);
  if (patch.adminNote !== undefined) data.adminNote = patch.adminNote?.trim().slice(0, 500) || null;
  if (patch.password !== undefined) {
    if (patch.password === null) data.passwordHash = `!nopass:${randomBytes(8).toString("hex")}`;
    else {
      if (patch.password.length < 8 || !/[0-9]/.test(patch.password) || !/[A-Za-zА-Яа-я]/.test(patch.password)) throw new ApiError(400, "Пароль: от 8 символов, буквы и цифры", "validation");
      data.passwordHash = await hashPassword(patch.password);
    }
  }
  const next = await prisma.user.update({ where: { id: user.id }, data });
  if (data.status === "blocked") await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  logEvent("admin.user_update", { actor: actor.userId, user: user.id, fields: Object.keys(data) });
  return { id: next.id };
}

export async function deleteUser(actor: AppSession, userId: string) {
  if (userId === actor.userId) throw new ApiError(400, "Себя удалить нельзя", "self");
  const owned = await prisma.membership.findMany({ where: { userId, role: "OWNER" } });
  for (const item of owned) {
    if (!(await ownersLeft(item.tenantId, item.id))) throw new ApiError(409, "Человек — единственный владелец пространства. Сначала назначьте другого владельца.", "last_owner");
  }
  await prisma.user.delete({ where: { id: userId } });
  logEvent("admin.user_delete", { actor: actor.userId, user: userId });
  return { ok: true };
}

/** Новое пространство (отдельный аккаунт с изолированными данными). Ключи парсера и OpenRouter можно скопировать из другого. */
export async function createTenant(actor: AppSession, input: { name: string; ownerUserId?: string | null; shareFrom?: string | null }) {
  const name = input.name.trim();
  if (name.length < 2) throw new ApiError(400, "Название — от 2 символов", "validation");
  const base = name.toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  const slug = (await prisma.tenant.findUnique({ where: { slug: base } })) ? `${base}-${randomBytes(2).toString("hex")}` : base;
  const tenant = await prisma.tenant.create({ data: { name, slug, settings: DEFAULT_SETTINGS } });
  await ensureStages(tenant.id);
  const shared: string[] = [];
  if (input.shareFrom) {
    await tenantOrThrow(input.shareFrom);
    for (const provider of ["parser", "openrouter"]) {
      const row = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId: input.shareFrom, provider } } });
      if (!row?.secretEnc) continue;
      await prisma.integration.create({
        data: { tenantId: tenant.id, provider, config: row.config ?? {}, secretEnc: row.secretEnc, status: row.status, scopes: row.scopes, lastCheckedAt: row.lastCheckedAt },
      });
      shared.push(provider);
    }
  }
  if (input.ownerUserId) await grantAccess(actor, { userId: input.ownerUserId, tenantId: tenant.id, role: "OWNER" });
  await audit({ tenantId: tenant.id, actorId: actor.userId, action: "admin.tenant_create", meta: { shared } });
  return { id: tenant.id, name: tenant.name, shared };
}

export async function renameTenant(tenantId: string, name: string) {
  if (name.trim().length < 2) throw new ApiError(400, "Название — от 2 символов", "validation");
  await tenantOrThrow(tenantId);
  return prisma.tenant.update({ where: { id: tenantId }, data: { name: name.trim().slice(0, 80) } });
}

/** Ссылка-приглашение: человек открывает её, входит по почте или через Telegram и сразу получает доступ. */
export async function createInviteLink(actor: AppSession, input: { tenantId: string; role: Role; email?: string | null; note?: string | null; days?: number; sendEmail?: boolean }) {
  const tenant = await tenantOrThrow(input.tenantId);
  if (input.role === "OWNER") throw new ApiError(400, "Владельца назначают кнопкой «Дать доступ» у конкретного человека", "owner_locked");
  const days = Math.min(30, Math.max(1, Number(input.days) || 7));
  const result = await inviteMember(tenant.id, input.email || null, input.role, { note: input.note, days });
  const url = result.inviteUrl ?? `${appUrl()}${result.invitePath}`;
  let emailed = false;
  if (input.sendEmail && input.email) {
    await sendPlatformMail(
      input.email,
      `Приглашение в LeadFlow — «${tenant.name}»`,
      `Вам открыт доступ в LeadFlow.\nПространство: «${tenant.name}», роль: ${ROLE_LABEL[input.role]}.\n\nОткройте ссылку и войдите по почте или через Telegram:\n${url}\n\nСсылка одноразовая и действует ${days} дн.`,
    );
    emailed = true;
  }
  await audit({ tenantId: tenant.id, actorId: actor.userId, action: "admin.invite_create", meta: { role: input.role, email: input.email || null, emailed } });
  return { id: result.id, url, emailed, message: `Вам открыт доступ в LeadFlow — пространство «${tenant.name}», роль: ${ROLE_LABEL[input.role]}.\nОткройте ссылку и войдите по почте или через Telegram:\n${url}` };
}

export async function revokeInvite(invitationId: string) {
  await prisma.invitation.delete({ where: { id: invitationId } }).catch(() => {
    throw new ApiError(404, "Приглашение не найдено", "not_found");
  });
  return { ok: true };
}

/** Проверочное сообщение администратору от бота входа. */
export async function testBot(actor: AppSession) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!me.telegramId) throw new ApiError(422, "Сначала привяжите свой Telegram (кнопка «Привязать мой Telegram»).", "tg_not_linked");
  const ok = await notifyTelegram(me.telegramId, "✅ Бот входа LeadFlow работает. Сюда будут приходить новые заявки на доступ.");
  if (!ok) throw new ApiError(502, "Бот не смог написать. Откройте бота и нажмите «Start», затем повторите.", "tg_send_failed");
  return { ok: true };
}
