// What the cart and the checkout need to know about the catalogue IN THE BROWSER: enough to show
// a line (name, photo, price, limits). The prices here are only for display — the official ones
// are set by the server when the order is created.

import { commerce } from "@/config/commerce";
import { findVariant, missingOptions, selectionLabel, unitPrice, unitsAvailable } from "@/lib/data/availability";
import type { Product } from "@/lib/data/types";

export type CartProduct = Pick<Product, "id" | "slug" | "name" | "price" | "options" | "variants" | "stock" | "minQuantity"> & {
  images: Product["images"];
};

export function toCartCatalog(products: Product[]): CartProduct[] {
  return products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, price: p.price, options: p.options, variants: p.variants, stock: p.stock,
    minQuantity: p.minQuantity,
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
}

interface StoredLine {
  key: string;
  productId: string;
  variantId: string | null;
  selection: Record<string, string>;
  quantity: number;
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
  const image = product.images.find((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v)) ?? product.images[0];
  return {
    key: line.key,
    productId: product.id,
    variantId: variant?.id ?? null,
    selection,
    quantity: Math.min(line.quantity, available, commerce.maxQuantityPerLine),
    slug: product.slug,
    name: product.name,
    label: selectionLabel(product, selection),
    image: image ? { src: image.src, alt: image.alt } : null,
    unitPrice: unitPrice(product, variant),
    max: Math.min(available, commerce.maxQuantityPerLine),
    min: product.minQuantity,
  };
}
