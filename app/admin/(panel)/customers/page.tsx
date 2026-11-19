import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { getSession } from "@/lib/admin/auth";
import { customersFromOrders } from "@/lib/admin/reports";
import { data } from "@/lib/data";
import { CustomersTable } from "@/components/admin/CustomersTable";

export const metadata: Metadata = { title: t.admin.customers.title };

export default async function CustomersPage() {
  if (!(await getSession())) redirect("/admin/login");
  const customers = customersFromOrders(await (await data()).listOrders());
  return <CustomersTable customers={customers} />;
}
