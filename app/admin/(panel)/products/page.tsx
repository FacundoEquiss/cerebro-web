import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { canWrite, getSession } from "@/lib/admin/auth";
import { data } from "@/lib/data";
import { ProductsTable } from "@/components/admin/ProductsTable";

export const metadata: Metadata = { title: t.admin.products.title };

export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  const adapter = await data();
  const [products, categories] = await Promise.all([adapter.listAllProducts(), adapter.listCategories()]);
  return <ProductsTable products={products} categories={categories} canWrite={await canWrite(session)} />;
}
