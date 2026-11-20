// UNPAID ORDERS DO NOT HOLD STOCK FOREVER. An order still in "New" after ORDER_EXPIRY_HOURS
// (48 by default, 0 = never) is cancelled with the reason "expired" and its units go back to the
// shelf. Two ways, so it works on any hosting:
//
//   · lazily — whenever the admin panel lists orders or a new order is about to be created,
//     at most once a minute per server process;
//   · on a schedule — GET /api/cron/expire-orders with `Authorization: Bearer <CRON_SECRET>`,
//     from the platform's cron (vercel.json has one) or from any cron job with curl.

import { fill, t } from "@/i18n";
import { data } from "@/lib/data";
import { env } from "@/lib/env";

const THROTTLE_MS = 60_000;
const state = globalThis as unknown as { __lastExpiry?: number };

export async function expireStaleOrders({ force = false, now = Date.now() } = {}): Promise<number> {
  const hours = env().ORDER_EXPIRY_HOURS;
  // hours = 0: orders never expire by age — but a lapsed appointment hold is still released.
  if (!force && state.__lastExpiry && now - state.__lastExpiry < THROTTLE_MS) return 0;
  state.__lastExpiry = now;
  try {
    const adapter = await data();
    if (!adapter.storesOrders) return 0;
    const count = await adapter.expireOrders(hours, fill(t.admin.orders.expiredReason, { hours }));
    if (count > 0) console.info(`[orders] ${count} unpaid order(s) expired after ${hours} h; stock released`);
    return count;
  } catch (e) {
    // Never break the page or the purchase that triggered it.
    console.error("[orders-expiry]", e instanceof Error ? e.message : e);
    return 0;
  }
}
