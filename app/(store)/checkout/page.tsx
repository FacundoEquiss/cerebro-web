import type { Metadata } from "next";
import { commerce } from "@/config/commerce";
import { paths, t, tr } from "@/i18n";
import { toCartCatalog } from "@/lib/cart-catalog";
import { getProducts } from "@/lib/data";
import { env } from "@/lib/env";
import { payments } from "@/lib/payments";
import { pageMetadata } from "@/lib/seo";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";

// Rendered on request: the payment methods and the antibot come from the environment the server
// was STARTED with, not from the one it was built with.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return pageMetadata({ title: t.checkout.title, description: t.checkout.serverSetsTotal, path: paths.checkout(), noindex: true });
}

export default async function CheckoutPage() {
  const shipping = commerce.shipping.methods
    .filter((m) => m.enabled)
    .map((m) => ({ id: m.id, label: tr(m.label), detail: tr(m.detail), price: m.price, freeFrom: m.freeFrom, requiresAddress: m.requiresAddress }));
  return (
    <div className="container page">
      <h1 style={{ marginBottom: 22 }}>{t.checkout.title}</h1>
      <CheckoutForm
        catalog={toCartCatalog(await getProducts())}
        shipping={shipping}
        paymentMethods={payments().methods()}
        antibot={env().ANTIBOT_PROVIDER}
      />
    </div>
  );
}
