// GET /api/downloads/<order>/<line>?e=<expiry>&s=<signature> — hands over the file of a digital
// product. Three locks, in this order:
//   1. the link is signed by the server and has not expired (lib/orders/download.ts);
//   2. the order exists, is PAID right now and was not cancelled — asked to the database, not to
//      the link;
//   3. that line of the order is a digital product that still has a file.
// The file comes from the PRIVATE side of the storage adapter: it has no public address.

import { NextResponse } from "next/server";
import { data } from "@/lib/data";
import { env } from "@/lib/env";
import { canDownload, verifyDownload } from "@/lib/orders/download";
import { clientIp, hit } from "@/lib/rate-limit";
import { DIGITAL_TYPES, extensionOf, storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string; line: string }> }) {
  const { id, line } = await params;
  const index = Number(line);
  if (!hit(`download:${clientIp(request.headers)}`, 30, 60_000).allowed) return refuse("rate_limited", 429);
  const url = new URL(request.url);
  const check = verifyDownload(id, index, url.searchParams.get("e"), url.searchParams.get("s"), env().orderSecret);
  if (!check.ok) return refuse(check.reason, check.reason === "expired" ? 410 : 403);

  try {
    const adapter = await data();
    const order = adapter.storesOrders ? await adapter.getOrder(id) : null;
    if (!canDownload(order)) return refuse("not_paid", 403);
    const item = order!.lines[index];
    if (!item || item.type !== "digital") return refuse("not_found", 404);
    const file = await adapter.getDigitalFile(item.productId);
    const bytes = file ? await storage().getPrivate(file.file) : null;
    if (!file || !bytes) return refuse("not_found", 404);
    const name = file.name.replace(/[^\w. -]+/g, "_") || "download";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": DIGITAL_TYPES[extensionOf(file.file)] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    console.error("[download]", e instanceof Error ? e.message : e);
    return refuse("generic", 500);
  }
}
