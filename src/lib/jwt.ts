import { SignJWT, jwtVerify } from "jose";

export type SessionToken = {
  sub: string;
  tid: string;
  mid: string;
  sid: string;
  role: string;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) return null;
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionToken): Promise<string> {
  const key = secret();
  if (!key) throw new Error("AUTH_SECRET не задан или короче 32 символов");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(key);
}

export async function readSessionToken(token: string): Promise<SessionToken | null> {
  const key = secret();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (typeof payload.sub !== "string" || typeof payload.tid !== "string" || typeof payload.sid !== "string" || typeof payload.mid !== "string") {
      return null;
    }
    return {
      sub: payload.sub,
      tid: payload.tid,
      mid: payload.mid,
      sid: payload.sid,
      role: typeof payload.role === "string" ? payload.role : "VIEWER",
    };
  } catch {
    return null;
  }
}
