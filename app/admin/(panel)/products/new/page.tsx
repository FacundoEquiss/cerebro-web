import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { t } from "@/i18n";
import { canWrite, getSession } from "@/lib/admin/auth";
import { emptyProduct } from "@/lib/admin/products";
import { data } from "@/lib/data";
import { ProductEditor } from "@/components/admin/ProductEditor";

export const metadata: Metadata = { title: t.admin.products.title };

export default async function ProductEditorPage({ params }: { params: Promise<{ id?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  const { id } = await params;
  const adapter = await data();
  const [products, categories] = await Promise.all([adapter.listAllProducts(), adapter.listCategories()]);
  const product = id ? products.find((p) => p.id === decodeURIComponent(id)) : emptyProduct(categories[0]?.slug ?? "");
  if (!product) notFound();
  return <ProductEditor product={product} categories={categories} isNew={!id} canWrite={await canWrite(session)} />;
}
