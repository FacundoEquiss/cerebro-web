// THE FIRST BARRIER of the admin panel: without a valid session cookie, /admin redirects to the
// login and /api/admin answers 401. It is NOT the only barrier — every admin page and route
// checks the session again on its own (lib/admin/auth.ts), so a mistake in the matcher below
// cannot open anything.

import { NextResponse, type NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE } from "@/lib/admin/session";
import { env } from "@/lib/env";

const NOINDEX = "noindex, nofollow, noarchive";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = resolveSession(request.cookies.get(SESSION_COOKIE)?.value, env());
  const isLogin = pathname === "/admin/login" || pathname === "/api/admin/login";

  let response: NextResponse;
  if (session && pathname === "/admin/login") {
    response = NextResponse.redirect(new URL("/admin", request.url));
  } else if (session || isLogin) {
    response = NextResponse.next();
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } else {
    response = NextResponse.redirect(new URL("/admin/login", request.url));
  }
  response.headers.set("X-Robots-Tag", NOINDEX);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
