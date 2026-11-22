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
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { memberships: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Неверный email или пароль", "invalid_credentials");
  }
  const membership = user.memberships[0];
  if (!membership) throw new ApiError(403, "У пользователя нет рабочего пространства", "no_membership");
  return createUserSession(user.id, membership.id);
}

export async function switchWorkspace(userId: string, tenantId: string) {
  const membership = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!membership) throw new ApiError(404, "Рабочее пространство не найдено", "not_found");
  return createUserSession(userId, membership.id);
}

export async function inviteMember(tenantId: string, email: string, role: Role) {
  if (role === "OWNER") throw new ApiError(403, "Роль владельца передаётся отдельно", "owner_locked");
  const token = randomBytes(24).toString("hex");
  await prisma.invitation.create({
    data: {
      tenantId,
      email: email.toLowerCase(),
      role,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const appUrl = process.env.APP_URL || "";
  return { invitePath: `/invite/${token}`, inviteUrl: appUrl ? `${appUrl}/invite/${token}` : null };
}

export async function acceptInvite(userId: string, token: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new ApiError(400, "Приглашение недействительно или истекло", "invite_invalid");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email !== invitation.email) throw new ApiError(403, "Приглашение выписано на другой email", "invite_email");
  const membership = await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
    update: { role: invitation.role },
    create: { tenantId: invitation.tenantId, userId, role: invitation.role },
  });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  return createUserSession(userId, membership.id);
}
