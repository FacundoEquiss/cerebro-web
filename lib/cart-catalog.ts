// What the cart and the checkout need to know about the catalogue IN THE BROWSER: enough to show
// a line (name, photo, price, limits). The prices here are only for display — the official ones
// are set by the server when the order is created.

import { commerce } from "@/config/commerce";
import { findVariant, maxQuantityOf, missingOptions, roundQuantity, selectionLabel, unitPrice, unitsAvailable } from "@/lib/data/availability";
import type { Product, ProductType } from "@/lib/data/types";

export type CartProduct = Pick<Product, "id" | "slug" | "name" | "price" | "options" | "variants" | "stock" | "minQuantity" | "type" | "unit" | "step" | "maxQuantity"> & {
  images: Product["images"];
};

export function toCartCatalog(products: Product[]): CartProduct[] {
  return products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, price: p.price, options: p.options, variants: p.variants, stock: p.stock,
    minQuantity: p.minQuantity, type: p.type, unit: p.unit, step: p.step, maxQuantity: p.maxQuantity,
    // Only the photos that can represent a line: the first one and those tied to an option.
    images: p.images.filter((img, i) => i === 0 || img.option),
  }));
}

export interface ResolvedLine {
  key: string;
  productId: string;
  variantId: string | null;
  selection: Record<string, string>;
  quantity: number;
  slug: string;
  name: string;
  label: string;
  image: { src: string; alt: string } | null;
  unitPrice: number;
  max: number;
  min: number;
  step: number;
  unit: string;
  type: ProductType;
  /** Service only: the chosen slot (`YYYY-MM-DDTHH:MM`, wall time of the store). */
  slot: string | null;
}

interface StoredLine {
  key: string;
  productId: string;
  variantId: string | null;
  selection: Record<string, string>;
  quantity: number;
  slot?: string | null;
}

/** A saved cart line against today's catalogue. `null` = it can no longer be bought. */
export function resolveLine(line: StoredLine, catalog: CartProduct[]): ResolvedLine | null {
  const product = catalog.find((p) => p.id === line.productId) as (CartProduct & Product) | undefined;
  if (!product) return null;
  const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : findVariant(product, line.selection);
  if (line.variantId && !variant) return null;
  const selection = variant ? variant.options : line.selection;
  if (missingOptions(product, selection).length > 0) return null;
  const available = unitsAvailable(product, variant);
  if (available <= 0) return null;
  // Never in a cart: a product that is asked for, and a service without its slot (or with one that passed).
  if (product.type === "quote") return null;
  if (product.type === "service" && !(line.slot && line.slot > localNow())) return null;
  const max = Math.min(available, maxQuantityOf(product, commerce.maxQuantityPerLine));
  const step = product.step > 0 ? product.step : 1;
  // Snap what was saved to what can be bought today: inside the limits, on a multiple of the step.
  const snapped = roundQuantity(Math.max(product.minQuantity, Math.min(max, Math.round(line.quantity / step) * step)));
  if (snapped > max) return null;
  const image = product.images.find((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v)) ?? product.images[0];
  return {
    key: line.key,
    productId: product.id,
    variantId: variant?.id ?? null,
    selection,
    quantity: snapped,
    slug: product.slug,
    name: product.name,
    label: selectionLabel(product, selection),
    image: image ? { src: image.src, alt: image.alt } : null,
    unitPrice: unitPrice(product, variant),
    max,
    min: product.minQuantity,
    step,
    unit: product.unit,
    type: product.type,
    slot: product.type === "service" ? (line.slot ?? null) : null,
  };
}

/**
 * "Now" as a `YYYY-MM-DDTHH:MM` string to compare slots with. The exact comparison (in the time
 * zone of the store, with the minimum notice) is the server's; this only drops what is clearly past.
 */
function localNow(): string {
  return new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 16);
}

/** "2026-03-04T10:30" → the instant-free label "4 mar, 10:30" (it is already wall time of the store). */
export function slotLabel(slot: string, languageTag: string): string {
  const [date = "", time = ""] = slot.split("T");
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Intl.DateTimeFormat(languageTag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day}, ${time}`;
}
