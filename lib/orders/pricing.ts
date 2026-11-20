// THE SERVER SETS THE PRICE. This module turns "ids and quantities" into the official order:
// it looks every price up in the catalogue and ignores any amount that came in the request.
// The SQL adapters do the same inside `create_order()` (db/schema.sql); the two are kept
// in step by the tests.

import { commerce } from "@/config/commerce";
import { brand } from "@/config/brand";
import { lineTotal, roundMoney } from "@/lib/format";
import { resolveSlot } from "@/lib/booking/slots";
import { findVariant, missingOptions, needsShipping, roundQuantity, selectionLabel, unitPrice, unitsAvailable, validQuantity } from "@/lib/data/availability";
import { OrderError, type Order, type OrderLine, type OrderLineRequest, type OrderRequest, type Product, type QuoteRequest, type ShippingTerms } from "@/lib/data/types";

/** The method of an order with nothing to ship (only services, downloads…). */
export const NO_SHIPPING = "none";
const FREE: ShippingTerms = { price: 0, freeFrom: null };

/** Conditions of an enabled shipping method. Throws if it does not exist or is switched off. */
export function shippingTerms(methodId: string): ShippingTerms {
  if (methodId === NO_SHIPPING) return FREE;
  const method = shippingMethod(methodId);
  if (!method) throw new OrderError("shipping_method", methodId);
  return { price: method.price, freeFrom: method.freeFrom };
}

export function shippingPrice(terms: ShippingTerms, subtotal: number): number {
  return terms.freeFrom !== null && subtotal >= terms.freeFrom ? 0 : terms.price;
}

export function shippingMethod(methodId: string) {
  return commerce.shipping.methods.find((m) => m.id === methodId && m.enabled);
}

/** Does this request contain something that is shipped? Decided from the CATALOGUE, never from the browser. */
export function requestNeedsShipping(lines: Pick<OrderLineRequest, "productId">[], products: Pick<Product, "id" | "type">[]): boolean {
  const types = new Map(products.map((p) => [p.id, p.type]));
  return needsShipping(lines.map((l) => ({ type: types.get(l.productId) })));
}

export interface PricedOrder {
  lines: OrderLine[];
  subtotal: number;
  shippingMethodId: string;
  shippingPrice: number;
  total: number;
}

export interface PricingContext {
  /** Seats already taken per `<productId>|<slot start ISO>`, from the stored bookings. */
  taken?: Map<string, number>;
  now?: number;
}

function lineImage(product: Product, selection: Record<string, string>): string | null {
  const image =
    product.images.find((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v)) ?? product.images[0];
  return image?.src ?? null;
}

/** Pure: prices a request against a catalogue. */
export function priceOrder(
  request: Pick<OrderRequest, "lines" | "shippingMethodId">,
  products: Product[],
  terms?: ShippingTerms,
  context: PricingContext = {},
): PricedOrder {
  if (request.lines.length === 0) throw new OrderError("empty");
  const now = context.now ?? Date.now();
  const byId = new Map(products.map((p) => [p.id, p]));
  const wanted = new Map<string, number>(); // units asked per variant/product, across lines
  const seats = new Map<string, number>(); // seats asked per slot, across lines
  const lines: OrderLine[] = [];

  for (const line of request.lines) {
    const product = byId.get(line.productId);
    if (!product) throw new OrderError("unknown_product", line.productId);
    // A product without a public price is never bought from the cart: it is asked for.
    if (product.type === "quote") throw new OrderError("quote_only", product.id);
    const quantity = roundQuantity(Number(line.quantity));
    if (!validQuantity(product, quantity, commerce.maxQuantityPerLine)) throw new OrderError("quantity", product.id);

    let variant = null;
    let selection: Record<string, string> = {};
    if (product.options.length > 0) {
      if (line.variantId) {
        variant = product.variants.find((v) => v.id === line.variantId) ?? null;
        if (!variant) throw new OrderError("unknown_variant", line.variantId);
        selection = variant.options;
      } else {
        // Options declared: the customer MUST have chosen. Never assume a default silently.
        selection = line.selection ?? {};
        if (missingOptions(product, selection).length > 0) throw new OrderError("selection_required", product.id);
        variant = findVariant(product, selection) ?? null;
        if (!variant && product.variants.length > 0) throw new OrderError("unknown_variant", product.id);
      }
    }

    const stockKey = variant?.id ?? product.id;
    const asked = roundQuantity((wanted.get(stockKey) ?? 0) + quantity);
    wanted.set(stockKey, asked);
    if (asked > unitsAvailable(product, variant)) throw new OrderError("out_of_stock", product.id);

    let slot = null;
    if (product.type === "service") {
      // The slot must be one this service really offers now, and it must have room.
      slot = resolveSlot(product, line.slot, now);
      const key = `${product.id}|${slot.start}`;
      const booked = (seats.get(key) ?? 0) + quantity;
      seats.set(key, booked);
      const capacity = Math.max(1, Math.trunc(product.service?.capacity ?? 1));
      if ((context.taken?.get(key) ?? 0) + booked > capacity) throw new OrderError("slot_taken", product.id);
    }

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      variantLabel: selectionLabel(product, selection),
      quantity,
      unitPrice: unitPrice(product, variant),
      image: lineImage(product, selection),
      type: product.type,
      unit: product.unit,
      slot,
    });
  }

  // Each line is rounded to cents on its own, and the subtotal adds the rounded lines: that is
  // what the customer sees line by line, and what create_order() does in SQL.
  const subtotal = roundMoney(lines.reduce((sum, l) => sum + lineTotal(l), 0));
  if (subtotal < commerce.minimumOrder) throw new OrderError("minimum_order", String(commerce.minimumOrder));
  // SHIPPING ONLY IF SOMETHING IS SHIPPED. A booking and a download travel nowhere.
  const ships = needsShipping(lines);
  const methodId = ships ? request.shippingMethodId : NO_SHIPPING;
  const shipping = ships ? roundMoney(shippingPrice(terms ?? shippingTerms(methodId), subtotal)) : 0;
  return { lines, subtotal, shippingMethodId: methodId, shippingPrice: shipping, total: roundMoney(subtotal + shipping) };
}

/** Builds the official `Order` from a priced request. */
export function buildOrder(id: string, request: OrderRequest, priced: PricedOrder, createdAt: string): Order {
  return {
    id,
    createdAt,
    currency: brand.currency,
    lines: priced.lines,
    subtotal: priced.subtotal,
    shipping: { methodId: priced.shippingMethodId, price: priced.shippingPrice },
    total: priced.total,
    paymentProvider: request.paymentProvider,
    paymentMethod: request.paymentMethod,
    status: "new",
    paidAt: null,
    tracking: null,
    quote: null,
  };
}

/** Pure: the enquiry about a `quote` product, as an order with no price yet. */
export function buildQuote(id: string, request: QuoteRequest, products: Product[], createdAt: string): Order {
  const product = products.find((p) => p.id === request.productId);
  if (!product) throw new OrderError("unknown_product", request.productId);
  if (product.type !== "quote") throw new OrderError("not_a_quote", product.id);
  const quantity = roundQuantity(Number(request.quantity));
  if (!validQuantity({ ...product, maxQuantity: product.maxQuantity ?? 1_000_000 }, quantity, 1_000_000)) throw new OrderError("quantity", product.id);
  return {
    id,
    createdAt,
    currency: brand.currency,
    lines: [{
      productId: product.id, variantId: null, name: product.name, variantLabel: "", quantity, unitPrice: 0,
      image: product.images[0]?.src ?? null, type: "quote", unit: product.unit, slot: null, note: request.detail,
    }],
    subtotal: 0,
    shipping: { methodId: NO_SHIPPING, price: 0 },
    total: 0,
    paymentProvider: "manual",
    paymentMethod: "bank_transfer",
    status: "quote",
    paidAt: null,
    tracking: null,
    quote: { sentAt: null },
  };
}

export { quoteTotals } from "./quote-totals";
