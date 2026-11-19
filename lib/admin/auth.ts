// SERVER ONLY. Reads the admin session of the current request. EVERY admin page and EVERY admin
// route calls one of these on its own: the proxy (proxy.ts) is a first barrier, never the only one.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { data } from "@/lib/data";
import { env } from "@/lib/env";
import { sameOrigin } from "@/lib/rate-limit";
import { resolveSession, SESSION_COOKIE, type AdminSession } from "./session";

export async function getSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(token, env());
}

export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });
export const forbidden = (error: "read_only" | "origin") => NextResponse.json({ error }, { status: 403 });

type Guard = { session: AdminSession; response?: undefined } | { session?: undefined; response: NextResponse };

/** For routes that only read. */
export async function requireAdmin(): Promise<Guard> {
  const session = await getSession();
  return session ? { session } : { response: unauthorized() };
}

/**
 * For routes that change something: a session, a real admin (not the demo user), the store's own
 * origin, and an adapter that can actually save.
 */
export async function requireWriter(request: Request): Promise<Guard> {
  const session = await getSession();
  if (!session) return { response: unauthorized() };
  if (!sameOrigin(request)) return { response: forbidden("origin") };
  if (session.role !== "admin" || !(await data()).writable) return { response: forbidden("read_only") };
  return { session };
}

/** Whether this session can save changes (what the UI uses to show the read-only notice). */
export async function canWrite(session: AdminSession): Promise<boolean> {
  return session.role === "admin" && (await data()).writable;
}
