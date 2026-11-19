import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { fill, paths, t } from "@/i18n";
import { getCategories, getProducts } from "@/lib/data";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { ShopView, type ShopSearchParams } from "@/components/catalog/ShopView";
import { JsonLd } from "@/components/ui/JsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const categories = await getCategories();
  return pageMetadata({
    title: t.shop.title,
    description: fill(t.shop.metaDescription, { brand: brand.name, categories: categories.map((c) => c.name).join(", ") }),
    path: paths.shop(),
  });
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopSearchParams> }) {
  const [products, categories, params] = await Promise.all([getProducts(), getCategories(), searchParams]);
  return (
    <>
      <ShopView title={t.shop.title} products={products} categories={categories} basePath={paths.shop()} params={params} />
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.home, path: "/" }, { name: t.shop.title, path: paths.shop() }])} />
    </>
  );
}
