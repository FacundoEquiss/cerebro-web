import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { fill, paths, t } from "@/i18n";
import { getCategories, getProducts } from "@/lib/data";
import { searchProducts } from "@/lib/data/query";
import { pageMetadata } from "@/lib/seo";
import { ProductGrid } from "@/components/catalog/ProductCard";
import styles from "./search.module.css";

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export function generateMetadata(): Metadata {
  // Result pages are infinite and thin: never indexed.
  return pageMetadata({ title: t.search.title, description: t.search.start, path: paths.search(), noindex: true });
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? "";
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const results = q ? searchProducts(products, q) : [];

  return (
    <div className="container page">
      <h1 className={styles.title}>{q ? fill(t.search.resultsFor, { q }) : t.search.title}</h1>
      <form method="get" action={paths.search()} role="search" className={styles.form}>
        <label htmlFor="q" className="sr-only">{t.search.placeholder}</label>
        <input id="q" name="q" type="search" className="input" defaultValue={q} placeholder={t.search.placeholder} autoComplete="off" enterKeyHint="search" data-testid="search-input" />
        <button type="submit" className="btn"><Search aria-hidden size={18} /> {t.search.submit}</button>
      </form>

      {q && results.length > 0 ? (
        <>
          <p className={`muted ${styles.count}`}>{results.length === 1 ? t.shop.resultOne : fill(t.shop.results, { n: results.length })}</p>
          <ProductGrid products={results} priorityCount={4} />
        </>
      ) : (
        <div className={styles.empty}>
          <p>{q ? fill(t.search.noResults, { q }) : t.search.start}</p>
          {q ? <p className="muted">{t.search.noResultsHint}</p> : null}
          <ul className={styles.suggestions}>
            {categories.map((c) => (
              <li key={c.slug}><Link href={paths.category(c.slug)} className="btn btn-secondary">{c.name}</Link></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
