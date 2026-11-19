import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/admin/session";
import { sameOrigin } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
