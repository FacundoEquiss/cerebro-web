"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { fill, t } from "@/i18n";
import { selectionLabel } from "@/lib/data/availability";
import type { Category, Product } from "@/lib/data/types";
import { fold, formatPrice } from "@/lib/format";
import { adminFetch } from "./api";
import styles from "./tables.module.css";

const p = t.admin.products;

/** One stock box. Saves when it loses focus or on Enter. Empty = made to order. */
function StockInput({ product, variantId, initial, label, canWrite }: { product: Product; variantId: string | null; initial: number | null; label: string; canWrite: boolean }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [saved, setSaved] = useState(initial === null ? "" : String(initial));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    if (value === saved) return;
    const stock = value.trim() === "" ? null : Number(value);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      setState("error");
      return;
    }
    setState("saving");
    const result = await adminFetch("/api/admin/products/stock", { json: { productId: product.id, variantId, stock } });
    if (result.ok) {
      setSaved(value);
      setState("saved");
    } else {
      setState("error");
    }
  }

  return (
    <>
      <input
        className={styles.stockInput}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        placeholder={p.madeToOrder}
        aria-label={label}
        title={p.stockHint}
        data-state={state}
        data-testid="stock-input"
        readOnly={!canWrite}
        onChange={(e) => { setValue(e.target.value); setState("idle"); }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      <span className="sr-only" aria-live="polite">{state === "saved" ? p.saved : state === "error" ? p.saveFailed : ""}</span>
    </>
  );
}

export function ProductsTable({ products, categories, canWrite }: { products: Product[]; categories: Category[]; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;
  const list = useMemo(() => {
    const q = fold(query);
    return q ? products.filter((row) => fold(`${row.name} ${row.slug} ${row.category}`).includes(q)) : products;
  }, [products, query]);

  return (
    <>
      <div className="admin-head">
        <h1>{p.title}</h1>
        <label className={styles.search}>
          <Search aria-hidden size={16} />
          <span className="sr-only">{p.search}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={p.search} data-testid="products-search" />
        </label>
        <Link href="/admin/products/new" className="btn" data-testid="new-product"><Plus aria-hidden size={18} /> {p.new}</Link>
      </div>
      <div className="admin-card">
        {list.length > 0 ? (
          <table className="admin-table" data-testid="products-table">
            <thead>
              <tr><th>{p.title}</th><th>{t.admin.editor.category}</th><th className="num">{p.price}</th><th>{p.stock}</th><th>{t.admin.editor.state}</th></tr>
            </thead>
            <tbody>
              {list.map((product) => {
                const expanded = open.has(product.id);
                const variants = expanded ? product.variants : product.variants.slice(0, 3);
                return (
                  <tr key={product.id} data-testid="product-row">
                    <td>
                      <div className={styles.product}>
                        {product.images[0] ? <img src={product.images[0].src} alt="" width={44} height={55} loading="lazy" /> : <span />}
                        <Link href={`/admin/products/${encodeURIComponent(product.id)}`}>{product.name}</Link>
                      </div>
                    </td>
                    <td data-label={t.admin.editor.category}>{categoryName(product.category)}</td>
                    <td className="num" data-label={p.price}>{formatPrice(product.price)}</td>
                    <td>
                      {product.variants.length > 0 ? (
                        <div className={styles.stocks}>
                          {variants.map((v) => {
                            const label = selectionLabel(product, v.options);
                            return (
                              <div key={v.id} className={styles.stockRow}>
                                <span>{label}</span>
                                <StockInput product={product} variantId={v.id} initial={v.stock} label={fill(p.stockOf, { name: `${product.name} ${label}` })} canWrite={canWrite} />
                              </div>
                            );
                          })}
                          {product.variants.length > 3 ? (
                            <button type="button" className={styles.more} onClick={() => setOpen((s) => { const n = new Set(s); if (expanded) n.delete(product.id); else n.add(product.id); return n; })}>
                              {expanded ? t.common.close : fill(p.variants, { n: product.variants.length })}
                            </button>
                          ) : null}
                        </div>
                      ) : product.options.length > 0 ? (
                        <span className="admin-note">{p.madeToOrder}</span>
                      ) : (
                        <StockInput product={product} variantId={null} initial={product.stock} label={fill(p.stockOf, { name: product.name })} canWrite={canWrite} />
                      )}
                    </td>
                    <td>{product.draft
                      ? <span className={styles.pill} data-draft data-testid="draft-pill">{p.draft}</span>
                      : <span className={styles.pill} data-off={!product.active || undefined}>{product.active ? p.active : p.paused}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="admin-note">{p.empty}</p>
        )}
      </div>
    </>
  );
}
