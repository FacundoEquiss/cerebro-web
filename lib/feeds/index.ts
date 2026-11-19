// PRODUCT FEEDS for Google Merchant Center and for the Meta catalogue.
//
// Both start from the SAME rows — same ids as the pixel / GA4 `item_id` (variant id, or product
// id when there are no variants), same prices as the page — and differ where the platforms differ:
//
//   availability   Google: in_stock | out_of_stock | preorder | backorder
//                  Meta:   in stock | out of stock | available for order (+ others)
//   A made-to-order item is "available for order" for Meta. For Google it goes as `in_stock`
//   (it can always be bought; declare the handling time in the Merchant Center account):
//   `backorder` would oblige to publish an availability date.
//
// Do not reuse one platform's file for the other. Check each current spec before going live.

import { brand } from "@/config/brand";
import { paths } from "@/i18n";
import { absoluteUrl } from "@/lib/url";
import { availabilityOf, productAvailability, selectionLabel, unitPrice } from "@/lib/data/availability";
import type { Availability, Category, Product } from "@/lib/data/types";

export type GoogleAvailability = "in_stock" | "out_of_stock" | "preorder" | "backorder";
export type MetaAvailability = "in stock" | "out of stock" | "available for order";

export const googleAvailability = (a: Availability): GoogleAvailability => (a === "out_of_stock" ? "out_of_stock" : "in_stock");
export const metaAvailability = (a: Availability): MetaAvailability =>
  a === "in_stock" ? "in stock" : a === "made_to_order" ? "available for order" : "out of stock";

export interface FeedRow {
  id: string;
  groupId: string | null;
  title: string;
  description: string;
  link: string;
  image: string;
  extraImages: string[];
  availability: Availability;
  price: number;
  salePrice: number | null;
  productType: string;
  color: string | null;
  size: string | null;
  attributes: Record<string, string>;
}

/** One row per variant (or per product without variants). Pure. */
export function feedRows(products: Product[], categories: Category[], siteUrl: string): FeedRow[] {
  const categoryName = new Map(categories.map((c) => [c.slug, c.name]));
  const rows: FeedRow[] = [];
  for (const p of products) {
    if (p.images.length === 0) continue;
    const link = `${siteUrl}${paths.product(p.slug)}`;
    const base = {
      description: p.description,
      link,
      productType: categoryName.get(p.category) ?? p.category,
      attributes: p.attributes,
    };
    const prices = (current: number) => {
      const list = p.compareAtPrice && p.compareAtPrice > current ? p.compareAtPrice : null;
      return list ? { price: list, salePrice: current } : { price: current, salePrice: null };
    };
    const images = (selection: Record<string, string>) => {
      const own = p.images.filter((i) => i.option && Object.entries(i.option).every(([k, v]) => selection[k] === v));
      const ordered = [...own, ...p.images.filter((i) => !own.includes(i) && !i.option)];
      const list = (ordered.length > 0 ? ordered : p.images).map((i) => absoluteUrl(i.src, siteUrl));
      return { image: list[0]!, extraImages: list.slice(1, 10) };
    };
    const label = (optionId: string, selection: Record<string, string>) =>
      p.options.find((o) => o.id === optionId)?.values.find((v) => v.id === selection[optionId])?.label ?? null;

    if (p.variants.length === 0) {
      rows.push({ id: p.id, groupId: null, title: p.name, ...base, ...images({}), availability: productAvailability(p), ...prices(p.price), color: null, size: null });
      continue;
    }
    for (const v of p.variants) {
      rows.push({
        id: v.id,
        groupId: p.id,
        title: `${p.name} - ${selectionLabel(p, v.options)}`,
        ...base,
        ...images(v.options),
        availability: availabilityOf(p, v),
        ...prices(unitPrice(p, v)),
        color: label("color", v.options),
        size: label("size", v.options),
      });
    }
  }
  return rows;
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const tag = (name: string, value: string | null | undefined) => (value ? `<g:${name}>${esc(value)}</g:${name}>` : "");
const money = (n: number) => `${n.toFixed(2)} ${brand.currency}`;

function rss(title: string, siteUrl: string, items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(title)}</title>
<link>${esc(siteUrl)}</link>
<description>${esc(title)}</description>
${items.join("\n")}
</channel>
</rss>
`;
}

function common(r: FeedRow): string {
  return (
    tag("id", r.id) + tag("item_group_id", r.groupId) + tag("title", r.title.slice(0, 150)) +
    tag("description", r.description.slice(0, 5000)) + tag("link", r.link) + tag("image_link", r.image) +
    r.extraImages.map((i) => tag("additional_image_link", i)).join("") +
    tag("price", money(r.price)) + tag("sale_price", r.salePrice === null ? null : money(r.salePrice)) +
    tag("brand", brand.name) + tag("condition", "new") + tag("product_type", r.productType) +
    tag("color", r.color) + tag("size", r.size) + tag("material", r.attributes.material) +
    tag("gender", r.attributes.gender) + tag("age_group", r.attributes.ageGroup) +
    tag("google_product_category", r.attributes.googleCategory)
  );
}

export function googleFeedXml(rows: FeedRow[], siteUrl: string): string {
  return rss(
    `${brand.name} — Google`,
    siteUrl,
    rows.map(
      (r) =>
        // No barcode (GTIN) for own-brand products: say so instead of leaving the field empty.
        `<item>${common(r)}${tag("availability", googleAvailability(r.availability))}${tag("identifier_exists", r.attributes.gtin ? null : "no")}${tag("gtin", r.attributes.gtin)}</item>`,
    ),
  );
}

export function metaFeedXml(rows: FeedRow[], siteUrl: string): string {
  return rss(
    `${brand.name} — Meta`,
    siteUrl,
    rows.map((r) => `<item>${common(r)}${tag("availability", metaAvailability(r.availability))}</item>`),
  );
}
