// Opening the gateway's payment page for an order — at checkout, and again from the order page
// ("Pay now") when the first attempt failed or the buyer backed out. Starting twice is safe: each
// adapter sends the order id as its idempotency key, and the webhook credits a payment once.

import { paths } from "@/i18n";
import type { Customer, Order } from "@/lib/data/types";
import { env } from "@/lib/env";
import { sealTotal } from "@/lib/orders/receipt";
import { payments } from "./index";

/** The URL to send the buyer to, or `null` when this provider has nothing to open. Throws on failure. */
export async function startPayment(order: Order, customer: Pick<Customer, "name" | "email">, attribution: Record<string, string>, token: string): Promise<string | null> {
  const e = env();
  const provider = payments();
  const consent = attribution.consent === "granted";
  const started = await provider.start({
    order,
    customer: { phone: "", ...customer },
    returnUrl: `${e.siteUrl}${paths.order(order.id, token)}`,
    webhookUrl: `${e.siteUrl}/api/payments/${provider.id}/webhook`,
    metadata: {
      // The total WE quoted, sealed: the webhook compares what was paid against it.
      seal: sealTotal(order.id, order.total, order.currency, e.orderSecret),
      ...(consent ? { consent: "granted", fbp: attribution.fbp ?? "", fbc: attribution.fbc ?? "", ga_client_id: attribution.ga_client_id ?? "" } : {}),
    },
  });
  return started.type === "redirect" ? started.url : null;
}
