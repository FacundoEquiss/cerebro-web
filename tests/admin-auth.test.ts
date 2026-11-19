import { describe, expect, it } from "vitest";
import { checkLogin, DEMO_USER, LOGIN_MAX_ATTEMPTS, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS } from "@/lib/admin/login";
import { hashPassword, verifyPassword } from "@/lib/admin/password";
import { DEMO_SESSION_KEY, resolveSession, SESSION_TTL_MS, sessionKeyFor, signSession, verifySession } from "@/lib/admin/session";
// The CLI and the app must produce the same hashes.
import { hashPassword as cliHash } from "../scripts/admin-hash.mjs";

const SECRET = "session-secret-with-more-than-32-chars";
const hash = await hashPassword("correct horse battery");
const users = [{ email: "owner@example.com", hash }];

describe("password hash", () => {
  it("verifies the right password and nothing else", async () => {
    expect(hash).toMatch(/^scrypt\.[\w-]+\.[\w-]+$/);
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });
  it("salts: the same password gives different hashes", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("rejects malformed stored values without throwing", async () => {
    for (const bad of ["", "plain", "scrypt.only-two", "bcrypt.a.b", "scrypt.a.b.c", "scrypt.a."]) expect(await verifyPassword("x", bad)).toBe(false);
  });
  it("matches the hashes made by `npm run admin:hash`", async () => {
    expect(await verifyPassword("from the cli", cliHash("from the cli"))).toBe(true);
  });
});

describe("session cookie", () => {
  const now = Date.parse("2026-03-01T12:00:00.000Z");
  const token = signSession({ email: "owner@example.com", role: "admin" }, SECRET, now);

  it("accepts a valid session", () => {
    expect(verifySession(token, SECRET, now + 60_000)).toMatchObject({ email: "owner@example.com", role: "admin" });
  });
  it("rejects an expired session", () => {
    expect(verifySession(token, SECRET, now + SESSION_TTL_MS + 1)).toBeNull();
  });
  it("rejects a tampered session", () => {
    const [v, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "attacker@example.com", role: "admin", exp: now + SESSION_TTL_MS })).toString("base64url");
    expect(verifySession(`${v}.${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifySession(token, "another-secret-with-more-than-32-chars", now)).toBeNull();
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession("s1.e30.x", SECRET)).toBeNull();
  });
});

describe("which key may sign what", () => {
  const now = Date.parse("2026-03-01T12:00:00.000Z");
  const config = { adminSecret: SECRET, demoMode: true };

  it("accepts an admin session signed with the private secret", () => {
    const token = signSession({ email: "owner@example.com", role: "admin" }, sessionKeyFor("admin", SECRET), now);
    expect(resolveSession(token, config, now)).toMatchObject({ role: "admin" });
  });
  it("accepts a demo session signed with the public demo key — in demo mode only", () => {
    const token = signSession({ email: DEMO_USER.email, role: "demo" }, sessionKeyFor("demo", SECRET), now);
    expect(resolveSession(token, config, now)).toMatchObject({ role: "demo" });
    expect(resolveSession(token, { adminSecret: SECRET, demoMode: false }, now)).toBeNull();
  });
  it("NEVER accepts an admin session signed with the public demo key", () => {
    // What an attacker who read this repository can build.
    const forged = signSession({ email: "attacker@example.com", role: "admin" }, DEMO_SESSION_KEY, now);
    expect(resolveSession(forged, config, now)).toBeNull();
    // …nor with any well-known constant.
    for (const guess of ["", "secret", "demo", "changeme"]) {
      expect(resolveSession(signSession({ email: "a@example.com", role: "admin" }, guess, now), config, now)).toBeNull();
    }
  });
});

describe("login", () => {
  const config = { users, demoMode: false };

  it("signs in with the right credentials, whatever the case of the e-mail", async () => {
    expect(await checkLogin({ email: " Owner@Example.com ", password: "correct horse battery", ip: "10.0.0.1" }, config)).toEqual({ ok: true, email: "owner@example.com", role: "admin" });
  });
  it("refuses a wrong password and an unknown user with the same answer", async () => {
    expect(await checkLogin({ email: "second@example.com", password: "nope", ip: "10.0.0.2" }, { users: [{ email: "second@example.com", hash }], demoMode: false })).toEqual({ ok: false, reason: "credentials" });
    expect(await checkLogin({ email: "ghost@example.com", password: "nope", ip: "10.0.0.2" }, config)).toEqual({ ok: false, reason: "credentials" });
  });
  it("offers the read-only demo user only in demo mode", async () => {
    const input = { email: DEMO_USER.email, password: DEMO_USER.password, ip: "10.0.0.3" };
    expect(await checkLogin(input, config)).toEqual({ ok: false, reason: "credentials" });
    expect(await checkLogin(input, { users, demoMode: true })).toEqual({ ok: true, email: DEMO_USER.email, role: "demo" });
  });
  it("limits the attempts per E-MAIL: rotating the address does not buy more guesses", async () => {
    const now = Date.parse("2026-03-01T12:00:00.000Z");
    const target = { users: [{ email: "third@example.com", hash }], demoMode: false };
    // Every attempt comes from a different address, as with a forged forwarded-for header.
    const attempt = (password: string, n: number, at = now) => checkLogin({ email: "third@example.com", password, ip: `10.1.0.${n}` }, target, at);
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) expect(await attempt("wrong", i)).toEqual({ ok: false, reason: "credentials" });
    // Over the limit: refused from ANY address, even with the right password.
    const refused = await attempt("correct horse battery", 99);
    expect(refused).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((refused as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    // Another account is not affected, and the window ends.
    expect((await checkLogin({ email: "owner@example.com", password: "correct horse battery", ip: "10.1.0.1" }, config, now)).ok).toBe(true);
    expect((await attempt("correct horse battery", 100, now + LOGIN_WINDOW_MS + 1)).ok).toBe(true);
  });
  it("also limits one address trying many e-mails", async () => {
    const now = Date.parse("2026-04-01T12:00:00.000Z");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS_PER_IP; i++) {
      expect(await checkLogin({ email: `user${i}@example.com`, password: "x", ip: "10.2.0.1" }, config, now)).toEqual({ ok: false, reason: "credentials" });
    }
    expect(await checkLogin({ email: "owner@example.com", password: "correct horse battery", ip: "10.2.0.1" }, config, now)).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});
