import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { ApiError } from "./errors";
import { readSessionToken, signSession } from "./jwt";
import type { RoleName } from "./domain/rbac";

export type AppSession = {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  membershipId: string;
  role: RoleName;
  sessionId: string;
};

const COOKIE = "lf_session";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function writeSessionCookie(session: AppSession) {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new ApiError(503, "На сервере не задан AUTH_SECRET длиной от 32 символов.", "auth_unconfigured");
  }
  const token = await signSession({
    sub: session.userId,
    tid: session.tenantId,
    mid: session.membershipId,
    sid: session.sessionId,
    role: session.role,
  });
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSession(): Promise<AppSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const payload = await readSessionToken(token);
  if (!payload) return null;
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { memberships: { include: { tenant: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const membership = session.user.memberships.find((item) => item.id === payload.mid) ?? session.user.memberships[0];
  if (!membership) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    membershipId: membership.id,
    role: membership.role,
    sessionId: session.id,
  };
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Войдите в систему", "auth_required");
  return session;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Недопустимый источник запроса", "csrf");
  }
  if (!host || originHost !== host) throw new ApiError(403, "Недопустимый источник запроса", "csrf");
}

export async function createUserSession(userId: string, membershipId: string) {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: { include: { tenant: true } } },
  });
  const membership = user.memberships.find((item) => item.id === membershipId) ?? user.memberships[0];
  if (!membership) throw new ApiError(403, "Нет доступа к рабочему пространству", "no_membership");
  const app: AppSession = {
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    membershipId: membership.id,
    role: membership.role,
    sessionId: session.id,
  };
  await writeSessionCookie(app);
  return app;
}
