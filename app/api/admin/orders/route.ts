// GET /api/admin/orders?v=<version> — what the kanban polls. Cheap on purpose: when nothing
// changed since `v` it answers `{ unchanged: true }` and the browser keeps what it has.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { ordersVersion } from "@/lib/admin/orders";
import { data } from "@/lib/data";
import { expireStaleOrders } from "@/lib/orders/expiry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard.response) return guard.response;
  await expireStaleOrders();
  const orders = await (await data()).listOrders();
  const version = ordersVersion(orders);
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.get("v") === version) return NextResponse.json({ unchanged: true, version }, { headers });
  return NextResponse.json({ version, orders }, { headers });
}
