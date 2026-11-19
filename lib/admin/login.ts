// Who may sign in, and how often they may try. Pure (the environment and the clock are passed
// in), so the tests cover it without a server.

import type { AdminUser } from "@/lib/env";
import { blocked, hit } from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "./password";
import type { AdminRole } from "./session";

/** The read-only account of demo mode. Its credentials are PUBLIC: they are shown on the login screen. */
export const DEMO_USER = { email: "demo@example.com", password: "demo" } as const;

/** Failed attempts allowed per E-MAIL (whatever address they come from) and per ADDRESS. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_MAX_ATTEMPTS_PER_IP = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Verifying against a real hash even when the e-mail is unknown keeps the response time the same,
// so the login does not reveal which addresses exist.
let decoy: Promise<string> | undefined;

export type LoginResult =
  | { ok: true; email: string; role: AdminRole }
  | { ok: false; reason: "credentials" | "rate_limited"; retryAfterSeconds?: number };

export async function checkLogin(
  input: { email: string; password: string; ip: string },
  config: { users: AdminUser[]; demoMode: boolean },
  now = Date.now(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, 200);
  // FAILED attempts are counted twice: per e-mail — so changing address (or faking the
  // forwarded-for header) does not buy more guesses at the same account — and per address.
  // Once over a limit every attempt is refused until the window ends, the right password included.
  const byEmail = `login:email:${email}`;
  const byIp = `login:ip:${input.ip}`;
  for (const limit of [blocked(byEmail, LOGIN_MAX_ATTEMPTS, now), blocked(byIp, LOGIN_MAX_ATTEMPTS_PER_IP, now)]) {
    if (!limit.allowed) return { ok: false, reason: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const user = config.users.find((u) => u.email === email);
  decoy ??= hashPassword("decoy-password-never-matches");
  const valid = await verifyPassword(input.password, user?.hash ?? (await decoy));
  if (user && valid) return { ok: true, email, role: "admin" };
  if (config.demoMode && email === DEMO_USER.email && input.password === DEMO_USER.password) {
    return { ok: true, email, role: "demo" };
  }
  hit(byEmail, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, now);
  hit(byIp, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS, now);
  return { ok: false, reason: "credentials" };
}
