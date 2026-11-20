// GET /api/slots?product=<id>&date=YYYY-MM-DD — the slots of a service on one day, with the seats
// that are left. Public and read-only: it says how many seats, never who booked them. The real
// check happens when the order is created (the slot is reserved there, with the row locked).

import { NextResponse } from "next/server";
import { seatsTaken, serviceRules, slotsOn } from "@/lib/booking/slots";
import { data } from "@/lib/data";
import { clientIp, hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hit(`slots:${clientIp(request.headers)}`, 120, 60_000).allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const adapter = await data();
  const product = (await adapter.listProducts()).find((p) => p.id === url.searchParams.get("product") && p.type === "service");
  if (!product || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const slots = slotsOn(product, date, Date.now());
  const { capacity } = serviceRules(product);
  let taken = new Map<string, number>();
  if (slots.length > 0) {
    const bookings = await adapter.listBookings(slots[0]!.start, new Date(Date.parse(slots.at(-1)!.start) + 1000).toISOString());
    taken = seatsTaken(bookings.filter((b) => b.productId === product.id));
  }
  return NextResponse.json(
    { date, slots: slots.map((s) => ({ time: s.time, start: s.start, left: Math.max(0, capacity - (taken.get(s.start) ?? 0)) })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
