import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { canWrite, getSession } from "@/lib/admin/auth";
import { ordersVersion } from "@/lib/admin/orders";
import { data } from "@/lib/data";
import { expireStaleOrders } from "@/lib/orders/expiry";
import { OrdersBoard } from "@/components/admin/OrdersBoard";

export const metadata: Metadata = { title: t.admin.orders.title };

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  await expireStaleOrders();
  const orders = await (await data()).listOrders();
  return <OrdersBoard initial={orders} initialVersion={ordersVersion(orders)} serverNow={Date.now()} canWrite={await canWrite(session)} />;
}
