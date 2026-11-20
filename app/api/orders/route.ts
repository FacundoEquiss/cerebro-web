// POST /api/orders — the ONE door through which an order is created.
// The browser sends ids, quantities and the buyer's data. It never sends a price that counts:
// unknown keys are dropped by the schema and every amount is looked up on the server.

import { after, NextResponse } from "next/server";
import { paths } from "@/i18n";
import { antibot } from "@/lib/antibot";
import { data } from "@/lib/data";
import { OrderError } from "@/lib/data/types";
import { env } from "@/lib/env";
import { normalizeCustomer, normalizeLines } from "@/lib/orders/idempotency";
import { notifyOrderCreated } from "@/lib/orders/notify";
import { NO_SHIPPING, requestNeedsShipping, shippingMethod, shippingTerms } from "@/lib/orders/pricing";
import { expireStaleOrders } from "@/lib/orders/expiry";
import { signReceipt } from "@/lib/orders/receipt";
import { orderRequestSchema } from "@/lib/orders/schema";
import { payments } from "@/lib/payments";
import { startPayment } from "@/lib/payments/start";
import { clientIp, hit, sameOrigin } from "@/lib/rate-limit";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("origin", 403);
  const ip = clientIp(request.headers);
  // Per address (from a trusted source, see lib/rate-limit.ts), plus a ceiling for the whole
  // store: an address can be hidden or rotated, the total cannot.
  const limit = [hit(`order:ip:${ip}`, 10, 60_000), hit("order:all", 240, 60_000)].find((l) => !l.allowed);
  if (limit) return fail("rate_limited", 429, { retryAfterSeconds: limit.retryAfterSeconds });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("generic", 400);
  }
  const parsed = orderRequestSchema.safeParse(json);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path.at(-1) ?? "");
    return fail("invalid", 400, { field });
  }
  const body = parsed.data;

  if (!(await antibot().verify(body.antibotToken, ip))) return fail("antibot", 403);

  const provider = payments();
  if (!provider.methods().includes(body.paymentMethod)) return fail("payment_method", 400);

  const customer = normalizeCustomer(body.customer);
  // …and per buyer: the same e-mail cannot flood the order list whatever address it comes from.
  const perBuyer = hit(`order:email:${customer.email}`, 12, 10 * 60_000);
  if (!perBuyer.allowed) return fail("rate_limited", 429, { retryAfterSeconds: perBuyer.retryAfterSeconds });
  const e = env();
  try {
    const adapter = await data();
    // SHIPPING ONLY IF SOMETHING IS SHIPPED — and that is read from the catalogue, not from the
    // browser: an order of services and downloads has no method, no address and no shipping cost.
    const ships = requestNeedsShipping(body.lines, await adapter.listProducts());
    const shippingMethodId = ships ? (body.shippingMethodId ?? "") : NO_SHIPPING;
    if (ships) {
      const method = shippingMethod(shippingMethodId);
      if (!method) throw new OrderError("shipping_method", shippingMethodId);
      if (method.requiresAddress && !(customer.address && customer.city && customer.postalCode)) throw new OrderError("address_required");
    }

    // Free the stock and the slots held by orders nobody paid, before this buyer is told "no".
    await expireStaleOrders();
    const order = await adapter.createOrder(
      {
        idempotencyKey: body.idempotencyKey,
        lines: normalizeLines(body.lines),
        customer,
        shippingMethodId,
        paymentProvider: provider.id,
        paymentMethod: body.paymentMethod,
        attribution: body.attribution,
      },
      shippingTerms(shippingMethodId),
    );

    // The buyer's key to their own order: a signed receipt in the URL, no cookie needed.
    const token = signReceipt(order, e.orderSecret);
    const orderPath = paths.order(order.id, token);
    const orderUrl = `${e.siteUrl}${orderPath}`;
    const attribution = body.attribution ?? {};
    const consent = attribution.consent === "granted";

    let redirect: string | null = null;
    let paymentError = false;
    if (body.paymentMethod === "online") {
      try {
        redirect = await startPayment(order, customer, attribution, token);
      } catch (err) {
        // The order exists; only the payment could not be opened. The checkout says so and the
        // order page offers "Pay now".
        console.error("[payment-start]", err instanceof Error ? err.message : err);
        paymentError = true;
      }
    }

    // E-mails and server-side events go out AFTER the response: the buyer never waits for them.
    after(() =>
      notifyOrderCreated(
        order,
        customer,
        orderUrl,
        { email: customer.email, phone: customer.phone, name: customer.name, fbp: attribution.fbp, fbc: attribution.fbc, gaClientId: attribution.ga_client_id, ip, userAgent: request.headers.get("user-agent") ?? undefined },
        consent,
      ),
    );

    return NextResponse.json({ orderId: order.id, url: paymentError ? `${orderPath}&pay=failed` : orderPath, redirect, paymentError });
  } catch (err) {
    if (err instanceof OrderError) return fail(err.code, 409, { detail: err.detail });
    console.error("[order]", err instanceof Error ? err.message : err);
    return fail("generic", 500);
  }
}
