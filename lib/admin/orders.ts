// What the admin panel may do with an order. The RULES live here (which moves are allowed, the
// purchase is reported once); the adapter only stores. Used by the routes under /api/admin.

import { data } from "@/lib/data";
import { AdminError, type AdminOrder, type OrderStatus } from "@/lib/data/types";
import { sendServerEvent } from "@/lib/analytics/server";
import { env } from "@/lib/env";
import { canMove } from "@/lib/orders/status";

/**
 * THE PURCHASE IS REPORTED ONCE PER ORDER, from the server, with the order id as `event_id`.
 * `claimPurchaseEvent` gives `true` to the first caller only — the webhook and the admin panel
 * can both reach "paid", and whoever arrives second does nothing.
 */
export async function reportPurchaseOnce(
  order: AdminOrder,
  deps: { claim: (id: string) => Promise<boolean>; send: typeof sendServerEvent; siteUrl: string },
): Promise<boolean> {
  if (order.purchaseSentAt) return false;
  if (!(await deps.claim(order.id))) return false;
  // Only with the buyer's consent, recorded with the order at checkout.
  if (order.attribution.consent === "granted") {
    await deps.send({
      name: "purchase",
      eventId: order.id,
      value: order.total,
      currency: order.currency,
      items: order.lines.map((l) => ({ id: l.variantId ?? l.productId, name: l.name, price: l.unitPrice, quantity: l.quantity })),
      url: deps.siteUrl,
      user: {
        email: order.customer.email,
        phone: order.customer.phone,
        fbp: order.attribution.fbp,
        fbc: order.attribution.fbc,
        gaClientId: order.attribution.ga_client_id,
      },
    });
  }
  return true;
}

export async function moveOrder(id: string, to: OrderStatus, actor: string, reason = ""): Promise<AdminOrder> {
  const adapter = await data();
  const current = await adapter.getAdminOrder(id);
  if (!current) throw new AdminError("not_found");
  if (!canMove(current.status, to)) throw new AdminError("invalid_transition", `${current.status} → ${to}`);
  const order = await adapter.setOrderStatus(id, current.status, to, actor, reason);
  if (to === "paid") {
    await reportPurchaseOnce(order, { claim: (orderId) => adapter.claimPurchaseEvent(orderId), send: sendServerEvent, siteUrl: env().siteUrl }).catch(
      (e) => console.error("[purchase-event]", e instanceof Error ? e.message : e),
    );
  }
  return order;
}

/** A fingerprint of the list: the kanban polls with it and gets "nothing changed" when equal. */
export function ordersVersion(orders: AdminOrder[]): string {
  let h = 5381;
  for (const o of orders) {
    const s = `${o.id}:${o.status}:${o.history.length}:${o.tracking ?? ""}`;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `${orders.length}-${(h >>> 0).toString(36)}`;
}
