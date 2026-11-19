// Which payment adapter is active is decided by PAYMENT_PROVIDER (manual by default).
// To add another gateway implement `PaymentAdapter`, register it here and add its name to the
// enum in lib/env.ts. The webhook route (/api/payments/<id>/webhook) and the checkout need no
// changes. See docs/adapters.md.

import { env } from "@/lib/env";
import { manualAdapter } from "./manual";
import { mercadopagoAdapter } from "./mercadopago";
import { stripeAdapter } from "./stripe";
import type { PaymentAdapter } from "./types";

export const paymentAdapters: Record<string, PaymentAdapter> = {
  manual: manualAdapter,
  mercadopago: mercadopagoAdapter,
  stripe: stripeAdapter,
};

export function payments(): PaymentAdapter {
  return paymentAdapters[env().PAYMENT_PROVIDER] ?? manualAdapter;
}
