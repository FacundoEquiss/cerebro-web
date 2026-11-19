import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { commerce } from "@/config/commerce";
import { fill, paths, t, tr } from "@/i18n";
import { getCategory, getProduct, getProducts } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { breadcrumbJsonLd, pageMetadata, productJsonLd } from "@/lib/seo";
import { TrackView } from "@/components/analytics/TrackView";
import { ProductGrid } from "@/components/catalog/ProductCard";
import { ProductView } from "@/components/product/ProductView";
import { JsonLd } from "@/components/ui/JsonLd";
import styles from "./product.module.css";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return (await getProducts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: t.notFound.title, robots: { index: false, follow: false } };
  return pageMetadata({
    title: product.name,
    description: `${product.description.slice(0, 150).trim()} ${formatPrice(product.price)}.`,
    path: paths.product(slug),
  });
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const [category, all] = await Promise.all([getCategory(product.category), getProducts()]);
  const related = all.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  const trail = [
    { name: t.common.home, path: "/" },
    { name: t.shop.title, path: paths.shop() },
    ...(category ? [{ name: category.name, path: paths.category(category.slug) }] : []),
    { name: product.name, path: paths.product(product.slug) },
  ];
  const shipping = commerce.shipping.methods.filter((m) => m.enabled);

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          {trail.map((item, i) => (
            <li key={item.path}>
              {i < trail.length - 1 ? <Link href={item.path}>{item.name}</Link> : <span aria-current="page">{item.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      <ProductView product={product} />

      <div className={styles.details}>
        <section aria-labelledby="product-description">
          <h2 id="product-description">{t.product.description}</h2>
          <p>{product.description}</p>
        </section>
        <section aria-labelledby="product-shipping">
          <h2 id="product-shipping">{t.product.shippingAndPickup}</h2>
          <ul>
            {shipping.map((m) => (
              <li key={m.id}>
                <strong>{tr(m.label)}</strong> — {m.price === 0 ? t.common.free : formatPrice(m.price)}
                {m.freeFrom !== null && m.price > 0 ? ` · ${fill(t.product.freeShippingFrom, { price: formatPrice(m.freeFrom) })}` : ""}
                <br />
                <span className="muted">{tr(m.detail)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {related.length > 0 ? (
        <section className="section" aria-labelledby="product-related">
          <div className="section-head"><h2 id="product-related">{t.product.related}</h2></div>
          <ProductGrid products={related} />
        </section>
      ) : null}

      <TrackView name="view_item" items={[{ productId: product.id, name: product.name, price: product.price, quantity: 1 }]} />
      <JsonLd data={productJsonLd(product, category)} />
      <JsonLd data={breadcrumbJsonLd(trail)} />
    </div>
  );
}
