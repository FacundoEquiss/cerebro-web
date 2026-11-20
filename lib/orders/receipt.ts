// THE SIGNED RECEIPT. After an order is created the browser gets a token: the order itself
// (lines, totals, expiry) plus an HMAC only the server can produce. The order page decodes it —
// no database and, above all, NO COOKIE. That is what makes it work inside the in-app browsers of
// social apps, where cookies set a moment ago often do not come back and the buyer gets locked
// out of their own order.
//
// The token carries no personal data: it can sit in a URL. It cannot be edited (the signature
// breaks) and it expires.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "@/lib/data/types";

export const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERSION = "v1";
// The receipt travels in a URL. Servers and proxies accept addresses of 14–16 KB; this stays under.
export const MAX_LENGTH = 12000;
/** What a FULL receipt may measure. Above it the lines are slimmed down (see `compact`). */
const COMFORTABLE = 6000;

interface Payload {
  o: Order;
  exp: number;
}

export type ReceiptResult =
  | { ok: true; order: Order; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" };

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`order-receipt/${VERSION}.${body}`).digest("base64url");
}

type Slim = 0 | 1 | 2;
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The receipt travels in a URL, so it is kept small:
 *   · the defaults of a line are left out and put back when it is read;
 *   · a slot is `[start in minutes since 1970, length in minutes]`;
 *   · the free text of an enquiry (`note`) NEVER travels: the order page reads it from the store;
 *   · a big order is slimmed in steps — first without the photos, then with short names and no
 *     ids — so that even 50 lines with slots fit. The amounts are never touched.
 */
function compact(order: Order, slim: Slim): unknown {
  const lines = order.lines.map((l) => {
    const { type, unit, slot, note: _note, image, productId, variantId, name, variantLabel, ...rest } = l;
    return {
      ...(slim < 2 ? { productId, variantId } : {}),
      name: slim < 2 ? name : short(name, 40),
      variantLabel: slim < 2 ? variantLabel : short(variantLabel, 24),
      ...rest,
      ...(slim < 1 ? { image } : {}),
      ...(type !== "physical" ? { type } : {}),
      ...(unit !== "u" ? { unit } : {}),
      ...(slot ? { s: [Math.round(Date.parse(slot.start) / 60_000), Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000)] } : {}),
    };
  });
  const { quote, ...rest } = order;
  return { ...rest, lines, ...(quote ? { quote } : {}) };
}

type StoredLine = Partial<Order["lines"][number]> & { s?: [number, number] };

function expand(order: Order): Order {
  return {
    ...order,
    quote: order.quote ?? null,
    lines: ((order.lines ?? []) as StoredLine[]).map(({ s, ...l }) => ({
      productId: "", variantId: null, name: "", variantLabel: "", quantity: 0, unitPrice: 0, image: null,
      ...l,
      type: l.type ?? "physical",
      unit: l.unit ?? "u",
      slot: s ? { start: new Date(s[0] * 60_000).toISOString(), end: new Date((s[0] + s[1]) * 60_000).toISOString() } : (l.slot ?? null),
    })),
  };
}

export function signReceipt(order: Order, secret: string, now = Date.now()): string {
  let token = "";
  for (const slim of [0, 1, 2] as Slim[]) {
    const payload = { o: compact(order, slim), exp: now + RECEIPT_TTL_MS };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    token = `${VERSION}.${body}.${sign(secret, body)}`;
    if (token.length <= (slim < 2 ? COMFORTABLE : MAX_LENGTH)) return token;
  }
  return token;
}

export function verifyReceipt(token: string | null | undefined, secret: string, now = Date.now()): ReceiptResult {
  if (!token || token.length > MAX_LENGTH) return { ok: false, reason: "invalid" };
  const [version, body, signature, ...rest] = token.split(".");
  if (version !== VERSION || !body || !signature || rest.length > 0) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!payload?.o?.id || typeof payload.exp !== "number") return { ok: false, reason: "invalid" };
  if (payload.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, order: expand(payload.o), expiresAt: payload.exp };
}

/** Order id derived from the idempotency key: the same key always names the same order. */
export function orderIdFromKey(idempotencyKey: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`order-id.${idempotencyKey}`).digest("hex");
  return `P-${digest.slice(0, 10).toUpperCase()}`;
}

/**
 * A short seal of "this order costs exactly this much", to travel in the payment gateway's
 * metadata. The webhook compares what was PAID against it before crediting anything.
 */
export function sealTotal(orderId: string, total: number, currency: string, secret: string): string {
  const body = `${total.toFixed(2)}.${currency}`;
  const sig = createHmac("sha256", secret).update(`order-total.${orderId}.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

/** The sealed total, or `null` if the seal is not ours. */
export function readSeal(orderId: string, seal: string | null | undefined, secret: string): { total: number; currency: string } | null {
  if (!seal || seal.length > 200) return null;
  const i = seal.lastIndexOf(".");
  const j = seal.lastIndexOf(".", i - 1);
  if (i < 0 || j < 0) return null;
  const total = Number(seal.slice(0, j));
  const currency = seal.slice(j + 1, i);
  if (!Number.isFinite(total) || !currency) return null;
  const expected = Buffer.from(sealTotal(orderId, total, currency, secret));
  const given = Buffer.from(seal);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { total, currency };
}
