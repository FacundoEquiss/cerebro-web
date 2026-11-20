// POST /api/admin/orders/<id> — every change to an order: move it, add a note, set the tracking.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireWriter } from "@/lib/admin/auth";
import { moveOrder } from "@/lib/admin/orders";
import { priceQuote, quoteLink, sendQuote } from "@/lib/admin/quotes";
import { data } from "@/lib/data";
import { AdminError, ReadOnlyError } from "@/lib/data/types";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), to: z.enum(["quote", "new", "paid", "preparing", "shipped", "delivered", "cancelled"]), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("note"), text: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("tracking"), tracking: z.string().trim().max(200) }),
  // An enquiry: save the prices, or save them and send the quote to the customer.
  z.object({ action: z.enum(["quote", "send_quote"]), prices: z.array(z.number().min(0).max(1_000_000_000)).min(1).max(50), shipping: z.number().min(0).max(1_000_000_000) }),
]);

const STATUS: Record<AdminError["code"], number> = { not_found: 404, conflict: 409, invalid_transition: 422, slug_taken: 409, category: 422, invalid: 400, needs_migration: 409, quote_incomplete: 422 };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWriter(request);
  if (guard.response) return guard.response;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = parsed.data;
  const actor = guard.session.email;

  try {
    if (body.action === "move" && body.to === "cancelled" && !body.reason) {
      return NextResponse.json({ error: "reason_required" }, { status: 400 });
    }
    const adapter = await data();
    if (body.action === "send_quote") {
      // `mailed` says whether the e-mail really went out; `link` lets the owner deliver it by hand.
      return NextResponse.json(await sendQuote(id, { prices: body.prices, shipping: body.shipping }, actor));
    }
    const order =
      body.action === "move" ? await moveOrder(id, body.to, actor, body.reason)
      : body.action === "note" ? await adapter.addOrderNote(id, body.text, actor)
      : body.action === "tracking" ? await adapter.setOrderTracking(id, body.tracking, actor)
      : await priceQuote(id, { prices: body.prices, shipping: body.shipping }, actor);
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.code }, { status: STATUS[e.code] });
    if (e instanceof ReadOnlyError) return NextResponse.json({ error: "read_only" }, { status: 403 });
    console.error("[admin-order]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}

/** GET /api/admin/orders/<id> — the customer's signed link to a quote, to copy or send by message. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.response) return guard.response;
  const { id } = await params;
  // The demo user reads everything else, but this link lets its holder accept a quote.
  if (guard.session.role !== "admin") return NextResponse.json({ link: null });
  return NextResponse.json({ link: await quoteLink(id) }, { headers: { "Cache-Control": "no-store" } });
}
