// THE IDEMPOTENCY KEY. One checkout attempt = one key. If the buyer taps "confirm" twice, the
// connection drops, or they come back and retry without changing anything, the server receives
// the SAME key and returns the SAME order instead of creating a second one.
//
// The trap: the key is derived from the form data, and the form data gets normalized (trimmed,
// lower-cased e-mail, phone digits). If the key were computed from the RAW text, a harmless
// difference ("Ana " vs "Ana", a re-autofilled phone) would change it → duplicate order.
// So the key is ALWAYS computed from the normalized data, with the same normalizer the server uses.
//
// Runs in the browser and in Node (Web Crypto). No secrets here.

import type { Customer, OrderLineRequest } from "@/lib/data/types";

const clean = (s: unknown) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

/** The ONE normalizer of the checkout data: used to build the key AND before saving the order. */
export function normalizeCustomer(c: Partial<Customer>): Customer {
  const out: Customer = {
    name: clean(c.name),
    email: clean(c.email).toLowerCase(),
    phone: clean(c.phone).replace(/[^\d+]/g, ""),
  };
  for (const k of ["address", "city", "postalCode", "notes"] as const) {
    const v = clean(c[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** Lines in a stable order, with only what identifies them. Prices never take part. */
export function normalizeLines(lines: OrderLineRequest[]): OrderLineRequest[] {
  return lines
    .map((l) => ({
      productId: l.productId,
      variantId: l.variantId ?? null,
      selection: Object.fromEntries(Object.entries(l.selection ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      quantity: Math.trunc(l.quantity),
    }))
    .sort((a, b) => JSON.stringify([a.productId, a.variantId, a.selection]).localeCompare(JSON.stringify([b.productId, b.variantId, b.selection])));
}

export interface KeyInput {
  /** Random value created when the checkout starts; it expires (see `stores/checkout-attempt.ts`). */
  seed: string;
  lines: OrderLineRequest[];
  customer: Partial<Customer>;
  shippingMethodId: string;
  paymentMethod: string;
}

export async function idempotencyKey(input: KeyInput): Promise<string> {
  const canonical = JSON.stringify([
    input.seed,
    normalizeLines(input.lines),
    normalizeCustomer(input.customer),
    input.shippingMethodId,
    input.paymentMethod,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
