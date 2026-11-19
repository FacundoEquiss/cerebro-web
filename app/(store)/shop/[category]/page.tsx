import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brand } from "@/config/brand";
import { fill, paths, t } from "@/i18n";
import { getCategories, getCategory, getProducts } from "@/lib/data";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { ShopView, type ShopSearchParams } from "@/components/catalog/ShopView";
import { JsonLd } from "@/components/ui/JsonLd";

type Props = { params: Promise<{ category: string }>; searchParams: Promise<ShopSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: t.notFound.title, robots: { index: false, follow: false } };
  const count = (await getProducts()).filter((p) => p.category === slug).length;
  return pageMetadata({
    title: category.name,
    // What the owner wrote about the category goes where search engines read it.
    description: category.description || fill(t.shop.categoryMeta, { category: category.name, brand: brand.name, count }),
    path: paths.category(slug),
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ category: slug }, query] = await Promise.all([params, searchParams]);
  const [category, products, categories] = await Promise.all([getCategory(slug), getProducts(), getCategories()]);
  if (!category) notFound();
  return (
    <>
      <ShopView
        title={category.name}
        products={products.filter((p) => p.category === slug)}
        categories={categories}
        activeCategory={slug}
        basePath={paths.category(slug)}
        params={query}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t.common.home, path: "/" },
          { name: t.shop.title, path: paths.shop() },
          { name: category.name, path: paths.category(slug) },
        ])}
      />
    </>
  );
}
