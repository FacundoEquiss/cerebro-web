// THE ADMIN SESSION: a signed cookie, nothing stored on the server. The cookie carries who it is,
// the role and when it expires, plus an HMAC only the server can produce. Edited → the signature
// breaks. Expired → rejected. Pure functions: the proxy, the pages, the routes and the tests all
// use these.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = "s1";

export type AdminRole = "admin" | "demo";

export interface AdminSession {
  email: string;
  /** `demo` can look at everything and change nothing. */
  role: AdminRole;
  exp: number;
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`admin-session/${VERSION}.${body}`).digest("base64url");
}

export function signSession(session: Omit<AdminSession, "exp">, secret: string, now = Date.now()): string {
  const payload: AdminSession = { ...session, exp: now + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(secret, body)}`;
}

export function verifySession(token: string | null | undefined, secret: string, now = Date.now()): AdminSession | null {
  if (!token || token.length > 1000) return null;
  const [version, body, signature, ...rest] = token.split(".");
  if (version !== VERSION || !body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSession;
    if (typeof session.email !== "string" || typeof session.exp !== "number") return null;
    if (session.role !== "admin" && session.role !== "demo") return null;
    if (session.exp < now) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * The key of DEMO sessions. It is public on purpose — the demo user's password is shown on the
 * login screen — and it can only ever produce a READ-ONLY session: `resolveSession` refuses any
 * other role signed with it. Sessions that can write are signed with a private secret, always.
 */
export const DEMO_SESSION_KEY = "demo-session-read-only";

export const sessionKeyFor = (role: AdminRole, adminSecret: string) => (role === "demo" ? DEMO_SESSION_KEY : adminSecret);

/** The session of a cookie, whichever of the two keys signed it. */
export function resolveSession(
  token: string | null | undefined,
  config: { adminSecret: string; demoMode: boolean },
  now = Date.now(),
): AdminSession | null {
  const admin = verifySession(token, config.adminSecret, now);
  if (admin) return admin.role === "admin" ? admin : null;
  if (!config.demoMode) return null;
  const demo = verifySession(token, DEMO_SESSION_KEY, now);
  return demo?.role === "demo" ? demo : null;
}
