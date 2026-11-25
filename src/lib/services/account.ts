import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { createUserSession, hashPassword, verifyPassword } from "../auth";
import { sha256 } from "../crypto";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { ensureStages } from "./common";
import type { Role } from "@prisma/client";

function slugify(value: string) {
  const base = value.toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return base || "workspace";
}

export async function registerAccount(input: { name: string; email: string; password: string; workspaceName: string }) {
  if (process.env.ALLOW_REGISTRATION === "false" && (await prisma.user.count()) > 0) {
    throw new ApiError(403, "Открытая регистрация отключена. Попросите приглашение.", "registration_closed");
  }
  const email = input.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new ApiError(409, "Пользователь с таким email уже есть", "email_taken");
  let slug = slugify(input.workspaceName);
  if (await prisma.tenant.findUnique({ where: { slug } })) slug = `${slug}-${randomBytes(2).toString("hex")}`;
  const user = await prisma.user.create({
    data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) },
  });
  const tenant = await prisma.tenant.create({
    data: { name: input.workspaceName.trim(), slug, settings: DEFAULT_SETTINGS },
  });
  const membership = await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
  await ensureStages(tenant.id);
  return createUserSession(user.id, membership.id);
}

export async function loginAccount(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { memberships: { orderBy: { createdAt: "asc" } } } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Неверный email или пароль", "invalid_credentials");
  }
  if (user.status === "blocked") throw new ApiError(403, "Доступ закрыт администратором.", "user_blocked");
  const membership = user.memberships[0];
  if (!membership) throw new ApiError(403, "Заявка ещё не одобрена: администратор пока не выдал доступ к пространству.", "no_membership");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return createUserSession(user.id, membership.id);
}

export async function switchWorkspace(userId: string, tenantId: string) {
  const membership = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!membership) throw new ApiError(404, "Рабочее пространство не найдено", "not_found");
  return createUserSession(userId, membership.id);
}

export async function inviteMember(tenantId: string, email: string | null, role: Role, options: { note?: string | null; days?: number } = {}) {
  if (role === "OWNER") throw new ApiError(403, "Роль владельца передаётся отдельно", "owner_locked");
  const token = randomBytes(24).toString("hex");
  const invitation = await prisma.invitation.create({
    data: {
      tenantId,
      email: email ? email.trim().toLowerCase() : null,
      role,
      note: options.note?.trim() || null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + (options.days ?? 7) * 24 * 60 * 60 * 1000),
    },
  });
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  return { id: invitation.id, invitePath: `/invite/${token}`, inviteUrl: appUrl ? `${appUrl}/invite/${token}` : null };
}

/** Действующее приглашение по коду из ссылки или ошибка. */
export async function findInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: { select: { name: true } } } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new ApiError(400, "Ссылка-приглашение недействительна или истекла. Попросите новую.", "invite_invalid");
  }
  return invitation;
}

/** Публичные сведения о ссылке: куда и с какой ролью она пускает. */
export async function invitationInfo(token: string) {
  const invitation = await findInvitation(token);
  return { tenantName: invitation.tenant.name, role: invitation.role, email: invitation.email, expiresAt: invitation.expiresAt };
}

export async function acceptInvitation(user: { id: string; email: string }, token: string) {
  const invitation = await findInvitation(token);
  if (invitation.email && user.email !== invitation.email) {
    throw new ApiError(403, `Приглашение выписано на ${invitation.email}. Войдите с этой почтой.`, "invite_email");
  }
  const existing = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } } });
  const membership = existing?.role === "OWNER"
    ? existing
    : await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
        update: { role: invitation.role },
        create: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role },
      });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  await prisma.user.update({ where: { id: user.id }, data: { status: "active" } });
  return membership;
}

export async function acceptInvite(userId: string, token: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const membership = await acceptInvitation(user, token);
  return createUserSession(userId, membership.id);
}
