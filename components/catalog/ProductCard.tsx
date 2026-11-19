import Link from "next/link";
import { paths, t } from "@/i18n";
import { productAvailability } from "@/lib/data/availability";
import type { Product } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";
import styles from "./ProductCard.module.css";

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const image = product.images[0];
  const availability = productAvailability(product);
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.price;
  const lowest = Math.min(product.price, ...product.variants.map((v) => v.price ?? product.price));
  const hasRange = product.variants.some((v) => (v.price ?? product.price) !== lowest);
  return (
    <article className={styles.card} data-testid="product-card">
      <Link href={paths.product(product.slug)} className={styles.link}>
        <div className={styles.media}>
          {image ? (
            <img
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
            />
          ) : null}
          <div className={styles.badges}>
            {availability === "out_of_stock" ? <span className="badge badge-out">{t.product.soldOut}</span> : null}
            {onSale && availability !== "out_of_stock" ? <span className="badge badge-sale">{t.product.sale}</span> : null}
            {availability === "made_to_order" ? <span className="badge">{t.product.madeToOrder}</span> : null}
          </div>
        </div>
        <h3 className={styles.name}>{product.name}</h3>
        <p className={styles.price}>
          {hasRange ? <span className={styles.from}>{t.product.from} </span> : null}
          <span className={`price ${onSale ? "price-sale" : ""}`}>{formatPrice(lowest)}</span>
          {onSale ? <span className="price-compare">{formatPrice(product.compareAtPrice!)}</span> : null}
        </p>
      </Link>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: Product[]; priorityCount?: number }) {
  return (
    <ul className={styles.grid} data-testid="product-grid">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
