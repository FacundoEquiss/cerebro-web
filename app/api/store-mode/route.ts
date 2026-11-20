// GET /api/store-mode — whether this store can take bookings, quotes and digital orders right
// now (lib/store-mode.ts). Asked by the product page when it opens, so the answer is never baked
// into a cached page.

import { NextResponse } from "next/server";
import { storeMode } from "@/lib/store-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: await storeMode() }, { headers: { "Cache-Control": "no-store" } });
}
