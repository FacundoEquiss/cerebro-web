import type { Availability, Product, Variant } from "./types";

/** The variant that matches a complete selection, if the product has generated variants. */
export function findVariant(product: Product, selection: Record<string, string>): Variant | undefined {
  return product.variants.find((v) => product.options.every((o) => v.options[o.id] === selection[o.id]));
}

/** Option ids still missing in a selection. Empty = the choice is complete. */
export function missingOptions(product: Product, selection: Record<string, string>): string[] {
  return product.options
    .filter((o) => !o.values.some((v) => v.id === selection[o.id]))
    .map((o) => o.id);
}

function fromStock(stock: number | null): Availability {
  if (stock === null) return "made_to_order";
  return stock > 0 ? "in_stock" : "out_of_stock";
}

/** Availability of one concrete choice (a variant, or the product itself when it has no options). */
export function availabilityOf(product: Product, variant?: Variant | null): Availability {
  if (variant) return fromStock(variant.stock);
  if (product.options.length > 0 && product.variants.length === 0) return "made_to_order";
  return fromStock(product.stock);
}

/** Availability of the product as a whole (card, feed row of a product without variants). */
export function productAvailability(product: Product): Availability {
  if (product.variants.length === 0) return availabilityOf(product);
  const all = product.variants.map((v) => fromStock(v.stock));
  if (all.includes("in_stock")) return "in_stock";
  if (all.includes("made_to_order")) return "made_to_order";
  return "out_of_stock";
}

/** Units a customer may add of one choice (`Infinity` when made to order). */
export function unitsAvailable(product: Product, variant?: Variant | null): number {
  const stock = variant ? variant.stock : product.options.length > 0 && product.variants.length === 0 ? null : product.stock;
  return stock === null ? Number.POSITIVE_INFINITY : stock;
}

export function unitPrice(product: Product, variant?: Variant | null): number {
  return variant?.price ?? product.price;
}

/** "M · Black": the labels of a selection, in the order the product declares its options. */
export function selectionLabel(product: Product, selection: Record<string, string>): string {
  return product.options
    .map((o) => o.values.find((v) => v.id === selection[o.id])?.label)
    .filter(Boolean)
    .join(" · ");
}

/** Three decimals are enough for grams in a kilo, and keep float noise out of a quantity. */
export function roundQuantity(q: number): number {
  return Math.round((q + Number.EPSILON) * 1000) / 1000;
}

/** Largest quantity of one line (in the product's unit). */
export function maxQuantityOf(product: Pick<Product, "maxQuantity">, fallback: number): number {
  return product.maxQuantity ?? fallback;
}

/**
 * Is this a quantity the product can be sold in? At least the minimum, at most the maximum, and a
 * multiple of the step (0.25, 0.5, 0.75… for a quarter kilo). The SERVER decides with this; the
 * browser only uses it to help.
 */
export function validQuantity(product: Pick<Product, "minQuantity" | "step" | "maxQuantity">, quantity: number, fallbackMax: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const step = product.step > 0 ? product.step : 1;
  const steps = quantity / step;
  return quantity >= product.minQuantity && quantity <= maxQuantityOf(product, fallbackMax) && Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Sold by the piece? Anything else (kg, g, m, l…) shows its price "per unit of measure". */
export function byPiece(product: Pick<Product, "unit">): boolean {
  return !product.unit || product.unit === "u";
}

/** Does anything in these lines have to be shipped or picked up? */
export function needsShipping(lines: { type?: string }[]): boolean {
  return lines.some((l) => (l.type ?? "physical") === "physical");
}
