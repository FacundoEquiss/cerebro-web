// GET /api/cron/expire-orders — cancels unpaid orders older than ORDER_EXPIRY_HOURS and returns
// their stock. Call it from any scheduler:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.example.com/api/cron/expire-orders
//
// Without CRON_SECRET the route does not exist. (The same clean-up also runs lazily, so the
// schedule is a safety net, not a requirement.)

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { expireStaleOrders } from "@/lib/orders/expiry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireStaleOrders({ force: true }) });
}
