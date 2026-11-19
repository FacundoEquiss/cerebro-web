import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLogin } from "@/lib/admin/login";
import { SESSION_COOKIE, SESSION_TTL_MS, sessionKeyFor, signSession } from "@/lib/admin/session";
import { env } from "@/lib/env";
import { clientIp, sameOrigin } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "credentials" }, { status: 401 });

  const e = env();
  const result = await checkLogin({ ...parsed.data, ip: clientIp(request.headers) }, { users: e.adminUsers, demoMode: e.demoMode });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, retryAfterSeconds: result.retryAfterSeconds },
      { status: result.reason === "rate_limited" ? 429 : 401 },
    );
  }

  const response = NextResponse.json({ ok: true, role: result.role });
  response.cookies.set(SESSION_COOKIE, signSession({ email: result.email, role: result.role }, sessionKeyFor(result.role, e.adminSecret)), {
    httpOnly: true,
    sameSite: "lax",
    // Always Secure on the real store. Plain http only exists on a laptop (localhost).
    secure: e.isProduction || new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
