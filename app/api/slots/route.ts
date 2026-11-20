// GET /api/slots?product=<id>                 → the days that can be booked, from today
// GET /api/slots?product=<id>&date=YYYY-MM-DD → the slots of that day, with the seats left
//
// Asked by the product page when it opens — never baked into a cached page, so a day that passed
// or filled up is not offered. Public and read-only: it says how many seats, never who booked
// them. The real check happens when the order is created (the slot is reserved there, locked).

import { NextResponse } from "next/server";
import { isEvent, openDates, seatsOverlapping, serviceRules, slotsOn, upcomingSessions } from "@/lib/booking/slots";
import { data } from "@/lib/data";
import { clientIp, hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hit(`slots:${clientIp(request.headers)}`, 120, 60_000).allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const adapter = await data();
  const product = (await adapter.listProducts()).find((p) => p.id === url.searchParams.get("product") && p.type === "service");
  if (!product || (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  const now = Date.now();
  const rules = serviceRules(product);
  const heldBetween = async (from: string, to: string) =>
    adapter.storesOrders ? (await adapter.listBookings(from, to)).map((b) => ({ productId: b.productId, start: b.start, end: b.end, seats: b.seats })) : [];
  if (date === null) {
    if (!isEvent(product)) return NextResponse.json({ dates: openDates(product, now), timeZone: rules.timeZone, stored: adapter.storesOrders }, { headers });
    // An event: its dates, each with the seats left, in one answer.
    const sessions = upcomingSessions(product, now);
    const held = sessions.length > 0 ? await heldBetween(sessions[0]!.start, sessions.reduce((max, s) => (s.end > max ? s.end : max), sessions[0]!.end)) : [];
    return NextResponse.json(
      { event: true, timeZone: rules.timeZone, stored: adapter.storesOrders, dates: [...new Set(sessions.map((s) => s.date))],
        sessions: sessions.map((s) => ({ slot: s.slot, start: s.start, end: s.end, left: Math.max(0, rules.capacity - seatsOverlapping(held, product.id, s.start, s.end)) })) },
      { headers },
    );
  }

  const slots = slotsOn(product, date, now);
  // Without a store nothing is reserved, so nothing is "taken": the example orders of a demo are
  // not real bookings and are never shown as such.
  const held = slots.length > 0 ? await heldBetween(slots[0]!.start, slots.at(-1)!.end) : [];
  return NextResponse.json(
    { date, stored: adapter.storesOrders, slots: slots.map((s) => ({ time: s.time, start: s.start, left: Math.max(0, rules.capacity - seatsOverlapping(held, product.id, s.start, s.end)) })) },
    { headers },
  );
}
