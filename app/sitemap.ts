import type { MetadataRoute } from "next";
import { paths } from "@/i18n";
import { getCategories, getProducts } from "@/lib/data";
import { env } from "@/lib/env";

// Rendered on request: it follows the environment the server was STARTED with (site URL,
// production or not), not the one it was built with. The catalogue read behind it is cached.
export const dynamic = "force-dynamic";

/** Only canonical, indexable pages: no cart, no search results, no unfinished legal templates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().siteUrl;
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const newest = products.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), "2026-01-01T00:00:00.000Z");
  return [
    { url: `${base}/`, lastModified: newest },
    { url: `${base}${paths.shop()}`, lastModified: newest },
    ...categories.map((c) => ({ url: `${base}${paths.category(c.slug)}`, lastModified: newest })),
    ...products.map((p) => ({ url: `${base}${paths.product(p.slug)}`, lastModified: p.createdAt })),
    { url: `${base}${paths.contact()}` },
  ];
}
