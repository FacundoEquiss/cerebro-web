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
