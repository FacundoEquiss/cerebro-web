// THE DOWNLOAD LINK of a digital product. It is signed (only the server can make one), it names
// one line of one order, and it EXPIRES. The link alone is not enough either: the route that
// serves the file (/api/downloads/…) asks the database whether that order is paid right now.
//
// The file itself is private: it lives in the private side of the storage adapter
// (lib/storage), never under public/.

import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (secret: string, orderId: string, line: number, expires: number) =>
  createHmac("sha256", secret).update(`download/v1.${orderId}.${line}.${expires}`).digest("base64url");

/** `/api/downloads/<order>/<line>?e=<expiry>&s=<signature>` — valid for `hours`. */
export function downloadPath(orderId: string, line: number, secret: string, hours: number, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + Math.round(hours * 3600);
  return `/api/downloads/${encodeURIComponent(orderId)}/${line}?e=${expires}&s=${sign(secret, orderId, line, expires)}`;
}

export type DownloadCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" };

export function verifyDownload(orderId: string, line: number, expires: string | null, signature: string | null, secret: string, now = Date.now()): DownloadCheck {
  const e = Number(expires);
  if (!signature || !Number.isInteger(e) || !Number.isInteger(line) || line < 0) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(secret, orderId, line, e));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (e * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** THE RULE: a file is delivered only for a paid order that was not cancelled. */
export function canDownload(order: { paidAt: string | null; status: string } | null | undefined): boolean {
  return Boolean(order && order.paidAt !== null && order.status !== "cancelled" && order.status !== "quote");
}
