// Numbers for the admin panel, computed from the order list. Pure: orders in, figures out.
// "Sales" = orders whose payment was confirmed (cancelled ones never count).

import type { AdminOrder } from "@/lib/data/types";

const DAY = 24 * 60 * 60 * 1000;

export interface PeriodSummary {
  /** Money of paid orders created in the period. */
  sales: number;
  /** Orders created in the period, cancelled excluded. */
  orders: number;
  paidOrders: number;
  averageTicket: number;
  pendingPayment: number;
  pendingAmount: number;
}

export interface SalesSummary {
  today: PeriodSummary;
  week: PeriodSummary;
  month: PeriodSummary;
  /** One point per day, oldest first, for the last 30 days. */
  daily: { date: string; sales: number; orders: number }[];
  topProducts: { productId: string; name: string; units: number; revenue: number }[];
}

const isPaid = (o: AdminOrder) => o.paidAt !== null && o.status !== "cancelled";

function period(orders: AdminOrder[], since: number): PeriodSummary {
  const inRange = orders.filter((o) => Date.parse(o.createdAt) >= since && o.status !== "cancelled");
  const paid = inRange.filter(isPaid);
  const pending = inRange.filter((o) => o.paidAt === null);
  const sales = paid.reduce((sum, o) => sum + o.total, 0);
  return {
    sales,
    orders: inRange.length,
    paidOrders: paid.length,
    averageTicket: paid.length > 0 ? Math.round((sales / paid.length) * 100) / 100 : 0,
    pendingPayment: pending.length,
    pendingAmount: pending.reduce((sum, o) => sum + o.total, 0),
  };
}

/** Local midnight of the day `now` falls in, as the server's clock sees it. */
function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function salesSummary(orders: AdminOrder[], now = Date.now()): SalesSummary {
  const today = startOfDay(now);
  const daily = Array.from({ length: 30 }, (_, i) => {
    const from = today - (29 - i) * DAY;
    const day = orders.filter((o) => isPaid(o) && Date.parse(o.createdAt) >= from && Date.parse(o.createdAt) < from + DAY);
    return { date: new Date(from).toISOString().slice(0, 10), sales: day.reduce((s, o) => s + o.total, 0), orders: day.length };
  });

  const products = new Map<string, { productId: string; name: string; units: number; revenue: number }>();
  for (const o of orders) {
    if (!isPaid(o) || Date.parse(o.createdAt) < today - 29 * DAY) continue;
    for (const l of o.lines) {
      const row = products.get(l.productId) ?? { productId: l.productId, name: l.name, units: 0, revenue: 0 };
      row.units += l.quantity;
      row.revenue += l.quantity * l.unitPrice;
      products.set(l.productId, row);
    }
  }

  return {
    today: period(orders, today),
    week: period(orders, today - 6 * DAY),
    month: period(orders, today - 29 * DAY),
    daily,
    topProducts: [...products.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, 6),
  };
}

export interface CustomerRow {
  key: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  /** Money of paid orders. */
  spent: number;
  lastOrderAt: string;
  lastOrderId: string;
}

/** Customers are not a table: they are whoever appears in the orders, grouped by e-mail. */
export function customersFromOrders(orders: AdminOrder[]): CustomerRow[] {
  const rows = new Map<string, CustomerRow>();
  for (const o of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = o.customer.email.trim().toLowerCase() || o.customer.phone;
    const row = rows.get(key) ?? {
      key, name: o.customer.name, email: o.customer.email, phone: o.customer.phone,
      orders: 0, spent: 0, lastOrderAt: o.createdAt, lastOrderId: o.id,
    };
    if (o.status !== "cancelled") row.orders += 1;
    if (isPaid(o)) row.spent += o.total;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
}
