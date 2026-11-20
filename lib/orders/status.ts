// THE ORDER WORKFLOW: the columns of the admin kanban and which moves are allowed.
// Pure and dependency-free: the kanban (browser), the admin service (server) and the tests all
// read the same table.

import type { OrderStatus } from "@/lib/data/types";

/** The kanban columns, left to right. `cancelled` is shown apart, folded. */
export const ORDER_FLOW: readonly OrderStatus[] = ["quote", "new", "paid", "preparing", "shipped", "delivered"];
export const ORDER_STATUSES: readonly OrderStatus[] = [...ORDER_FLOW, "cancelled"];

/**
 * Allowed moves. An order must be paid before it is prepared; a step can be undone while the
 * parcel has not been delivered; `paid` never goes back to `new` (the purchase was already
 * reported) and `cancelled` is final (its stock went back to the shelf).
 *
 * `quote` (an enquiry) is not moved by hand: it becomes `new` only when the CUSTOMER accepts the
 * quote that was sent (lib/admin/quotes.ts); the owner can only cancel it. An order with nothing
 * to ship (a service, a download) may go straight from `paid` to `delivered`.
 */
const MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  quote: ["cancelled"],
  new: ["paid", "cancelled"],
  paid: ["preparing", "shipped", "delivered", "cancelled"],
  preparing: ["paid", "shipped", "delivered", "cancelled"],
  shipped: ["preparing", "delivered"],
  delivered: ["shipped"],
  cancelled: [],
};

export function allowedMoves(from: OrderStatus): readonly OrderStatus[] {
  return MOVES[from] ?? [];
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return allowedMoves(from).includes(to);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** The next / previous column an order can move to with the keyboard, if any. */
export function neighbour(from: OrderStatus, direction: 1 | -1): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(from);
  if (i < 0) return null;
  for (let j = i + direction; j >= 0 && j < ORDER_FLOW.length; j += direction) {
    const to = ORDER_FLOW[j]!;
    if (canMove(from, to)) return to;
  }
  return null;
}
