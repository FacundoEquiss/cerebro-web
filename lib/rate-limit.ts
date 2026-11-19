// A small fixed-window rate limiter, in memory.
//
// HONEST LIMIT: memory is per server process. On one Node server (`next start`, Docker) it does
// its job. On serverless hosting each instance counts on its own, so treat it as a first barrier
// only and put a shared store behind `hit()` (Redis, a database table) when the store has real
// traffic — the call sites do not change.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
}

/** Is this key already over its limit? Reads without counting. */
export function blocked(key: string, limit: number, now = Date.now()): RateLimitResult {
  const current = windows.get(key);
  if (!current || current.resetAt <= now || current.count < limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
}

/**
 * THE CALLER'S ADDRESS — from a source that can be TRUSTED. `X-Forwarded-For` is a list anyone
 * can start with whatever they like; only what YOUR proxy adds can be believed.
 *
 *   TRUSTED_PROXY_HEADER=<header>  the header your platform or proxy sets with the real address
 *                                  (cf-connecting-ip, x-real-ip, fly-client-ip…). Its first value
 *                                  is used. On Vercel `x-vercel-forwarded-for` is used on its own.
 *   TRUSTED_PROXY_HEADER=none      trust no header (the server is reached directly): every
 *                                  caller shares one bucket.
 *   (not set)                      the LAST hop of X-Forwarded-For — the entry appended by the
 *                                  proxy right in front of this server, which a client cannot fake.
 *
 * Because an address can still be shared or unknown, limits that matter also count by something
 * the caller cannot rotate for free (the e-mail of the account or of the order).
 */
export function clientIp(
  headers: Headers,
  trusted: string = process.env.TRUSTED_PROXY_HEADER || (process.env.VERCEL ? "x-vercel-forwarded-for" : ""),
): string {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
  if (trusted.toLowerCase() === "none") return "unknown";
  if (trusted) return first(headers.get(trusted)) || "unknown";
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || "unknown";
}

/**
 * Write routes only accept calls from the store's own pages: the `Origin` header, when present,
 * must be this host. (No header = a non-browser client; the other checks still apply.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
