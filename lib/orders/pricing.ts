// THE SERVER SETS THE PRICE. This module turns "ids and quantities" into the official order:
// it looks every price up in the catalogue and ignores any amount that came in the request.
// The SQL adapters do the same inside `create_order()` (db/schema.sql); the two are kept
// in step by the tests.

import { commerce } from "@/config/commerce";
import { brand } from "@/config/brand";
import { roundMoney } from "@/lib/format";
import { findVariant, missingOptions, selectionLabel, unitPrice, unitsAvailable } from "@/lib/data/availability";
import { OrderError, type Order, type OrderLine, type OrderRequest, type Product, type ShippingTerms } from "@/lib/data/types";

/** Conditions of an enabled shipping method. Throws if it does not exist or is switched off. */
export function shippingTerms(methodId: string): ShippingTerms {
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

export interface PricedOrder {
  lines: OrderLine[];
  subtotal: number;
  shippingPrice: number;
  total: number;
}

/** Pure: prices a request against a catalogue. */
export function priceOrder(
  request: Pick<OrderRequest, "lines" | "shippingMethodId">,
  products: Product[],
  terms: ShippingTerms = shippingTerms(request.shippingMethodId),
): PricedOrder {
  if (request.lines.length === 0) throw new OrderError("empty");
  const byId = new Map(products.map((p) => [p.id, p]));
  const wanted = new Map<string, number>(); // units asked per variant/product, across lines
  const lines: OrderLine[] = [];

  for (const line of request.lines) {
    const product = byId.get(line.productId);
    if (!product) throw new OrderError("unknown_product", line.productId);
    const quantity = Math.trunc(line.quantity);
    if (!(quantity >= product.minQuantity && quantity <= commerce.maxQuantityPerLine)) {
      throw new OrderError("quantity", product.id);
    }

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
    const asked = (wanted.get(stockKey) ?? 0) + quantity;
    wanted.set(stockKey, asked);
    if (asked > unitsAvailable(product, variant)) throw new OrderError("out_of_stock", product.id);

    const image =
      product.images.find((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v)) ??
      product.images[0];
    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      variantLabel: selectionLabel(product, selection),
      quantity,
      unitPrice: unitPrice(product, variant),
      image: image?.src ?? null,
    });
  }

  const subtotal = roundMoney(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
  if (subtotal < commerce.minimumOrder) throw new OrderError("minimum_order", String(commerce.minimumOrder));
  const shipping = roundMoney(shippingPrice(terms, subtotal));
  return { lines, subtotal, shippingPrice: shipping, total: roundMoney(subtotal + shipping) };
}

/** Builds the official `Order` from a priced request. */
export function buildOrder(id: string, request: OrderRequest, priced: PricedOrder, createdAt: string): Order {
  return {
    id,
    createdAt,
    currency: brand.currency,
    lines: priced.lines,
    subtotal: priced.subtotal,
    shipping: { methodId: request.shippingMethodId, price: priced.shippingPrice },
    total: priced.total,
    paymentProvider: request.paymentProvider,
    paymentMethod: request.paymentMethod,
    status: "new",
    paidAt: null,
    tracking: null,
  };
}
