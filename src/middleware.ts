import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken } from "@/lib/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAsset = pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname === "/icon.svg" || pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname === "/offline.html" || pathname === "/pwa-icon";
  if (isAsset) return NextResponse.next();
  const token = request.cookies.get("lf_session")?.value;
  const payload = token ? await readSessionToken(token) : null;
  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname.startsWith("/invite");
  const isOptOut = pathname.startsWith("/opt-out/");
  const isPublicMail = pathname.startsWith("/brand/") || pathname.startsWith("/media/offers/");
  if (!payload && !isAuthPage && !isOptOut && !isPublicMail && !pathname.startsWith("/api")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (payload && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg).*)"] };
