// POST /api/quotes/accept — the customer accepts the quote they were sent. A plain HTML form on
// the order page posts the order id, its signed receipt, the total THEY SAW and how they will pay.
// The total is not trusted as a price: it is only compared with the stored one. If the quote was
// not sent, or its price changed since the page was opened, nothing is accepted.

import { NextResponse } from "next/server";
import { paths } from "@/i18n";
import { data } from "@/lib/data";
import { OrderError, type PaymentMethod } from "@/lib/data/types";
import { env } from "@/lib/env";
import { expireStaleOrders } from "@/lib/orders/expiry";
import { signReceipt, verifyReceipt } from "@/lib/orders/receipt";
import { payments } from "@/lib/payments";
import { startPayment } from "@/lib/payments/start";
import { clientIp, hit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const e = env();
  const form = await request.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const token = String(form?.get("t") ?? "");
  const method = String(form?.get("payment") ?? "") as PaymentMethod;
  const total = Number(form?.get("total"));
  const back = (t: string, flag?: string) => NextResponse.redirect(`${e.siteUrl}${paths.order(id, t)}${flag ? `&quote=${flag}` : ""}`, 303);

  // No origin check: the order page forbids referrers, so browsers send `Origin: null`. The signed
  // receipt IS the permission (see /api/orders/pay).
  if (!hit(`quote-accept:${clientIp(request.headers)}`, 20, 60_000).allowed || !hit(`quote-accept:order:${id}`, 10, 60_000).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const receipt = verifyReceipt(token, e.orderSecret);
  if (!receipt.ok || receipt.order.id !== id) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const provider = payments();
  if (!provider.methods().includes(method)) return back(token, "payment");

  try {
    const adapter = await data();
    if (!adapter.storesOrders) return back(token, "unavailable");
    await expireStaleOrders();
    const order = await adapter.acceptQuote(id, total, provider.id, method);
    // A fresh receipt: the old one was signed when the enquiry had no price.
    const fresh = signReceipt(order, e.orderSecret);
    if (order.status === "new" && order.paymentMethod === "online") {
      try {
        const stored = await adapter.getAdminOrder(id);
        const url = await startPayment(order, { name: stored?.customer.name ?? "", email: stored?.customer.email ?? "" }, stored?.attribution ?? {}, fresh);
        if (url) return NextResponse.redirect(url, 303);
      } catch (err) {
        console.error("[payment-start]", err instanceof Error ? err.message : err);
        return NextResponse.redirect(`${e.siteUrl}${paths.order(id, fresh)}&pay=failed`, 303);
      }
    }
    return back(fresh);
  } catch (err) {
    if (err instanceof OrderError) return back(token, err.code === "quote_changed" ? "changed" : err.code === "quote_not_sent" ? "not_sent" : "unavailable");
    console.error("[quote-accept]", err instanceof Error ? err.message : err);
    return back(token, "unavailable");
  }
}
