// Pure catalogue helpers (search, sort). Safe to import from client components.

import { fold } from "@/lib/format";
import { productAvailability } from "./availability";
import type { Product } from "./types";

/** Server-side search: ignores accents and case, every word must match. */
export function searchProducts(products: Product[], query: string): Product[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return products.filter((p) => {
    const haystack = fold(`${p.name} ${p.description} ${p.category}`);
    return words.every((w) => haystack.includes(w));
  });
}

export type SortKey = "featured" | "price_asc" | "price_desc" | "newest";

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const list = [...products];
  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => a.price - b.price);
    case "price_desc":
      return list.sort((a, b) => b.price - a.price);
    case "newest":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      // Featured first, sold-out last, the rest as they come.
      return list.sort(
        (a, b) =>
          Number(productAvailability(a) === "out_of_stock") - Number(productAvailability(b) === "out_of_stock") ||
          Number(b.featured) - Number(a.featured),
      );
  }
}
