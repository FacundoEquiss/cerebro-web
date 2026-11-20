// THE SERVER SETS THE PRICE. This module turns "ids and quantities" into the official order:
// it looks every price up in the catalogue and ignores any amount that came in the request.
// The SQL adapters do the same inside `create_order()` (db/schema.sql); the two are kept
// in step by the tests.

import { commerce } from "@/config/commerce";
import { brand } from "@/config/brand";
import { lineTotal, roundMoney } from "@/lib/format";
import { resolveSlot, seatsOverlapping, type Held } from "@/lib/booking/slots";
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
  /**
   * Every line is a product marked free, at 0, and nothing is charged for shipping: there is
   * nothing to pay, so the order is created already paid. Decided HERE, from the catalogue —
   * never from "the total happens to be 0".
   */
  nothingToPay: boolean;
}

export interface PricingContext {
  /** Seats already held by other orders (cancelled and lapsed ones excluded), from the store. */
  held?: Held[];
  /** Seats this same buyer already has (unpaid AND paid), for the cap on free places. */
  buyerSeats?: Held[];
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
  const bookedHere: Held[] = []; // seats asked by THIS order, line by line
  let serviceLines = 0;
  let allFree = true;
  const lines: OrderLine[] = [];

  for (const line of request.lines) {
    const product = byId.get(line.productId);
    if (!product) throw new OrderError("unknown_product", line.productId);
    // A product without a public price is never bought from the cart: it is asked for.
    if (product.type === "quote") throw new OrderError("quote_only", product.id);
    const quantity = roundQuantity(Number(line.quantity));
    if (!validQuantity(product, quantity, commerce.maxQuantityPerLine)) throw new OrderError("quantity", product.id);
    // A download is one licence per order line: there is no "three of the same file".
    if (product.type === "digital" && quantity !== 1) throw new OrderError("quantity", product.id);

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

    // NOTHING IS GIVEN AWAY BY ACCIDENT. A line costs 0 only when its product is marked free: a
    // variant at 0 on a priced product is refused, and so is a quantity so small that a priced
    // line rounds to 0 (0.001 kg of something cheap).
    const price = unitPrice(product, variant);
    if (price === 0 && !product.free) throw new OrderError("no_price", product.id);
    if (price > 0 && lineTotal({ unitPrice: price, quantity }) === 0) throw new OrderError("quantity", product.id);
    const freeLine = product.free && price === 0;
    allFree &&= freeLine;

    let slot = null;
    if (product.type === "service") {
      // The slot must be one this service really offers now, and it must have room.
      // One order cannot hoard the calendar.
      if (++serviceLines > commerce.booking.maxSlotsPerOrder) throw new OrderError("booking_limit", String(commerce.booking.maxSlotsPerOrder));
      if (!Number.isInteger(quantity)) throw new OrderError("quantity", product.id); // seats are whole
      slot = resolveSlot(product, line.slot, now);
      const capacity = Math.max(1, Math.trunc(product.service?.capacity ?? 1));
      const taken = seatsOverlapping(context.held ?? [], product.id, slot.start, slot.end) + seatsOverlapping(bookedHere, product.id, slot.start, slot.end);
      if (taken + quantity > capacity) throw new OrderError("slot_taken", product.id);
      // A free place costs nothing to take: seats per buyer per date are capped, paid ones included.
      if (freeLine) {
        const mine = seatsOverlapping(context.buyerSeats ?? [], product.id, slot.start, slot.end) + seatsOverlapping(bookedHere, product.id, slot.start, slot.end);
        if (mine + quantity > commerce.booking.maxFreeSeatsPerBuyer) throw new OrderError("free_seat_limit", String(commerce.booking.maxFreeSeatsPerBuyer));
      }
      bookedHere.push({ productId: product.id, start: slot.start, end: slot.end, seats: quantity });
    }

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      variantLabel: selectionLabel(product, selection),
      quantity,
      unitPrice: price,
      image: lineImage(product, selection),
      type: product.type,
      unit: product.unit,
      slot,
    });
  }

  // Each line is rounded to cents on its own, and the subtotal adds the rounded lines: that is
  // what the customer sees line by line, and what create_order() does in SQL.
  const subtotal = roundMoney(lines.reduce((sum, l) => sum + lineTotal(l), 0));
  // (The minimum order is about money: a cart of free products only is not held to it.)
  if (!allFree && subtotal < commerce.minimumOrder) throw new OrderError("minimum_order", String(commerce.minimumOrder));
  // SHIPPING ONLY IF SOMETHING IS SHIPPED. A booking and a download travel nowhere.
  const ships = needsShipping(lines);
  const methodId = ships ? request.shippingMethodId : NO_SHIPPING;
  const shipping = ships ? roundMoney(shippingPrice(terms ?? shippingTerms(methodId), subtotal)) : 0;
  const total = roundMoney(subtotal + shipping);
  return { lines, subtotal, shippingMethodId: methodId, shippingPrice: shipping, total, nothingToPay: allFree && total === 0 };
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
    // Nothing to pay (free products only): the order is born paid, in the same step.
    status: priced.nothingToPay ? "paid" : "new",
    paidAt: priced.nothingToPay ? createdAt : null,
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
