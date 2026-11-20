// POST /api/quotes — the door for products WITHOUT a public price ("ask for a quote").
// It registers an enquiry: an order in the status `quote`, with no amount. The owner prices it
// in the admin panel and sends it; only then can the customer accept it and pay.

import { after, NextResponse } from "next/server";
import { paths } from "@/i18n";
import { antibot } from "@/lib/antibot";
import { data } from "@/lib/data";
import { OrderError } from "@/lib/data/types";
import { env } from "@/lib/env";
import { normalizeCustomer } from "@/lib/orders/idempotency";
import { notifyQuoteRequested } from "@/lib/orders/notify";
import { signReceipt } from "@/lib/orders/receipt";
import { quoteRequestSchema } from "@/lib/orders/schema";
import { clientIp, hit, sameOrigin } from "@/lib/rate-limit";
import { storeMode } from "@/lib/store-mode";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("origin", 403);
  const ip = clientIp(request.headers);
  const limit = [hit(`quote:ip:${ip}`, 6, 60_000), hit("quote:all", 120, 60_000)].find((l) => !l.allowed);
  if (limit) return fail("rate_limited", 429, { retryAfterSeconds: limit.retryAfterSeconds });

  const parsed = quoteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid", 400, { field: String(parsed.error.issues[0]?.path.at(-1) ?? "") });
  const body = parsed.data;
  if (!(await antibot().verify(body.antibotToken, ip))) return fail("antibot", 403);

  const customer = normalizeCustomer(body.customer);
  const perBuyer = hit(`quote:email:${customer.email}`, 8, 10 * 60_000);
  if (!perBuyer.allowed) return fail("rate_limited", 429, { retryAfterSeconds: perBuyer.retryAfterSeconds });

  try {
    // An enquiry nobody can store is an enquiry nobody will answer: refuse it honestly.
    if ((await storeMode()) === "contact") throw new OrderError("needs_store", body.productId);
    const order = await (await data()).createQuote({
      idempotencyKey: body.idempotencyKey,
      productId: body.productId,
      quantity: body.quantity,
      detail: body.detail,
      customer,
      attribution: body.attribution,
    });
    const e = env();
    const orderPath = paths.order(order.id, signReceipt(order, e.orderSecret));
    after(() => notifyQuoteRequested(order, customer, `${e.siteUrl}${orderPath}`));
    return NextResponse.json({ orderId: order.id, url: orderPath });
  } catch (err) {
    if (err instanceof OrderError) return fail(err.code, 409, { detail: err.detail });
    console.error("[quote]", err instanceof Error ? err.message : err);
    return fail("generic", 500);
  }
}
