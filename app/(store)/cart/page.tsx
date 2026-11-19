import type { Metadata } from "next";
import { paths, t } from "@/i18n";
import { toCartCatalog } from "@/lib/cart-catalog";
import { getProducts } from "@/lib/data";
import { pageMetadata } from "@/lib/seo";
import { CartView } from "@/components/cart/CartView";

export function generateMetadata(): Metadata {
  return pageMetadata({ title: t.cart.title, description: t.cart.estimatedNote, path: paths.cart(), noindex: true });
}

export default async function CartPage() {
  return (
    <div className="container page">
      <h1 style={{ marginBottom: 22 }}>{t.cart.title}</h1>
      <CartView catalog={toCartCatalog(await getProducts())} />
    </div>
  );
}
