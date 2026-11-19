"use client";
// The seed of the idempotency key: created when a checkout starts, re-used on every retry, and
// EXPIRED after two hours or cleared when the order is done. A seed kept forever would make the
// customer's next, different purchase look like a retry of the old one.

const KEY = "checkout-attempt.v1";
const TTL_MS = 2 * 60 * 60 * 1000;

export function checkoutSeed(now = Date.now()): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { seed: string; at: number } | null;
    if (saved && now - saved.at < TTL_MS) return saved.seed;
    const seed = crypto.randomUUID();
    sessionStorage.setItem(KEY, JSON.stringify({ seed, at: now }));
    return seed;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearCheckoutSeed(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
