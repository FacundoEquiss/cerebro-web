import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { fill, paths, t } from "@/i18n";
import { productAvailability } from "@/lib/data/availability";
import { sortProducts, type SortKey } from "@/lib/data/query";
import type { Category, Product } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";
import { ProductGrid } from "./ProductCard";
import { FiltersDisclosure, SortSelect } from "./ShopControls";
import styles from "./ShopView.module.css";

export type ShopSearchParams = Record<string, string | string[] | undefined>;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "featured", label: t.shop.sortFeatured },
  { key: "price_asc", label: t.shop.sortPriceAsc },
  { key: "price_desc", label: t.shop.sortPriceDesc },
  { key: "newest", label: t.shop.sortNewest },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function readShopQuery(params: ShopSearchParams) {
  const sort = SORTS.some((s) => s.key === one(params.sort)) ? (one(params.sort) as SortKey) : "featured";
  const max = Number(one(params.max));
  return { sort, inStock: one(params.stock) === "1", onSale: one(params.sale) === "1", max: Number.isFinite(max) && max > 0 ? max : null };
}

/**
 * The grid of the shop, a category or a search. ONE row above it: title · category rail ·
 * "Filters" (a single button, with the number of active ones) · "Sort". Filters and sort are a
 * plain GET form, so they work without JavaScript and every combination is a shareable URL.
 */
export function ShopView({
  title, products, categories, activeCategory, basePath, params, hidden = {},
}: {
  title: string;
  products: Product[];
  categories: Category[];
  activeCategory?: string;
  basePath: string;
  params: ShopSearchParams;
  /** Extra fields the form must keep (the search query). */
  hidden?: Record<string, string>;
}) {
  const query = readShopQuery(params);
  const steps = priceSteps(products);
  let list = products;
  if (query.inStock) list = list.filter((p) => productAvailability(p) === "in_stock");
  if (query.onSale) list = list.filter((p) => p.compareAtPrice !== null && p.compareAtPrice > p.price);
  if (query.max !== null) list = list.filter((p) => p.price <= query.max!);
  list = sortProducts(list, query.sort);
  const active = Number(query.inStock) + Number(query.onSale) + Number(query.max !== null);

  return (
    <div className="container page">
      <form method="get" action={basePath} className={styles.bar} data-testid="shop-bar">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <h1 className={styles.title}>{title}</h1>
        <nav className={styles.rail} aria-label={t.nav.categories}>
          <Link href={paths.shop()} className={styles.pill} aria-current={!activeCategory && basePath === paths.shop() ? "page" : undefined}>
            {t.shop.all}
          </Link>
          {categories.map((c) => (
            <Link key={c.slug} href={paths.category(c.slug)} className={styles.pill} aria-current={activeCategory === c.slug ? "page" : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>
        <div className={styles.controls}>
          <FiltersDisclosure className={styles.filters}>
            <summary className={styles.pill} data-active={active > 0 || undefined} data-testid="filters-button">
              <SlidersHorizontal aria-hidden size={16} />
              {active > 0 ? fill(t.shop.filtersActive, { n: active }) : t.shop.filters}
            </summary>
            <div className={styles.panel}>
              <fieldset>
                <legend>{t.shop.availability}</legend>
                <label className={styles.check}><input type="checkbox" name="stock" value="1" defaultChecked={query.inStock} /> {t.shop.onlyInStock}</label>
                <label className={styles.check}><input type="checkbox" name="sale" value="1" defaultChecked={query.onSale} /> {t.shop.onSale}</label>
              </fieldset>
              <fieldset>
                <legend>{t.shop.price}</legend>
                <label className={styles.check}><input type="radio" name="max" value="" defaultChecked={query.max === null} /> {t.shop.anyPrice}</label>
                {steps.map((s) => (
                  <label key={s} className={styles.check}>
                    <input type="radio" name="max" value={s} defaultChecked={query.max === s} /> {fill(t.shop.priceUpTo, { price: formatPrice(s) })}
                  </label>
                ))}
              </fieldset>
              <div className={styles.panelActions}>
                <Link href={basePath + (hidden.q ? `?q=${encodeURIComponent(hidden.q)}` : "")} className="btn btn-ghost">{t.shop.clear}</Link>
                <button type="submit" className="btn">{t.shop.applyFilters}</button>
              </div>
            </div>
          </FiltersDisclosure>
          <label className={styles.sort}>
            <span className="sr-only">{t.shop.sort}</span>
            <SortSelect name="sort" defaultValue={query.sort} className={styles.pill} options={SORTS} />
          </label>
          <noscript><button type="submit" className={styles.pill}>{t.shop.applyFilters}</button></noscript>
        </div>
      </form>

      {list.length > 0 ? (
        <ProductGrid products={list} priorityCount={4} />
      ) : (
        <div className="empty-state">
          <p className="muted">{t.shop.empty}</p>
          <Link href={basePath} className="btn btn-secondary">{t.shop.clear}</Link>
        </div>
      )}
    </div>
  );
}

/** Up to three round "up to…" price steps taken from the prices on screen. */
function priceSteps(products: Product[]): number[] {
  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  if (prices.length < 4) return [];
  const round = (n: number) => {
    const unit = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(n, 1))) - 1) * 5;
    return Math.ceil(n / unit) * unit;
  };
  const picks = [0.25, 0.5, 0.75].map((q) => round(prices[Math.floor(q * (prices.length - 1))]!));
  return [...new Set(picks)].filter((s) => s < prices[prices.length - 1]!);
}
