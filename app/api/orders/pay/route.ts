// POST /api/orders/pay — the "Pay now" button of an unpaid order. A plain HTML form posts the
// order id and its signed receipt; the answer is a redirect to the gateway (or back to the order
// page with an error). No JavaScript and no cookie needed, so it works in in-app browsers.

import { NextResponse } from "next/server";
import { paths } from "@/i18n";
import { data } from "@/lib/data";
import { env } from "@/lib/env";
import { verifyReceipt } from "@/lib/orders/receipt";
import { payments } from "@/lib/payments";
import { startPayment } from "@/lib/payments/start";
import { clientIp, hit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const e = env();
  const form = await request.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const token = String(form?.get("t") ?? "");
  const back = (flag?: string) =>
    NextResponse.redirect(`${e.siteUrl}${paths.order(id, token)}${flag ? `&pay=${flag}` : ""}`, 303);

  // No origin check here: the order page forbids referrers (its address carries the receipt), so
  // browsers send `Origin: null`. The signed receipt IS the permission — and all this route can
  // do with it is send its holder to pay their own order.
  if (!hit(`pay:${clientIp(request.headers)}`, 20, 60_000).allowed || !hit(`pay:order:${id}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const receipt = verifyReceipt(token, e.orderSecret);
  if (!receipt.ok || receipt.order.id !== id) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const adapter = await data();
    // The receipt proves whose order it is; the database knows what it is worth and its status NOW.
    const stored = adapter.storesOrders ? await adapter.getAdminOrder(id) : null;
    const order = stored ?? receipt.order;
    if (order.paidAt || order.total <= 0 || order.status !== "new" || order.paymentMethod !== "online" || payments().id === "manual") return back();
    const url = await startPayment(order, { name: stored?.customer.name ?? "", email: stored?.customer.email ?? "" }, stored?.attribution ?? {}, token);
    return url ? NextResponse.redirect(url, 303) : back();
  } catch (err) {
    console.error("[payment-restart]", err instanceof Error ? err.message : err);
    return back("failed");
  }
}
