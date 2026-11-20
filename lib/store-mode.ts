// CAN THIS STORE REMEMBER AN ORDER? Services, quotes and digital products all need it: a slot is
// reserved by a stored order, a quote is priced on a stored enquiry, a download is handed over
// when a stored order is paid. With an adapter that stores nothing (`json` in production) they
// cannot work, so the store says so instead of pretending:
//
//   live     orders are stored: everything works.
//   demo     nothing is stored AND this is a demo (DEMO_MODE): the flows can be tried, and the
//            pages say that nothing is really reserved, priced or delivered.
//   contact  nothing is stored and it is a real store: those products cannot be bought online.
//            The page offers to get in touch, and the server refuses them.

import { data } from "@/lib/data";
import type { ProductType } from "@/lib/data/types";
import { env } from "@/lib/env";

export type StoreMode = "live" | "demo" | "contact";

export async function storeMode(): Promise<StoreMode> {
  return (await data()).storesOrders ? "live" : env().demoMode ? "demo" : "contact";
}

/** The types that need a store that remembers orders. */
export const needsStore = (type: ProductType | undefined) => type === "service" || type === "quote" || type === "digital";
