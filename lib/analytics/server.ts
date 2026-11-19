// Server side of the measurement: Meta Conversions API and GA4 Measurement Protocol.
//
//  · OFF outside production, and off without the IDs — both checks, always.
//  · `event_id` is shared with the browser event (or is the ORDER ID for a purchase), so the
//    platforms de-duplicate.
//  · Personal data is hashed (SHA-256) before it leaves; IP and user agent travel as Meta asks.
//  · Never throws and never blocks a response: call it inside `after()`.
//  · Describe in the privacy policy what is sent from the server — the visitor cannot block it
//    from the browser, which is why it only goes out when they consented (`consent: "granted"`).

import { createHash } from "node:crypto";
import { env } from "@/lib/env";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export interface UserData {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  fbp?: string;
  fbc?: string;
  ip?: string;
  userAgent?: string;
  gaClientId?: string;
}

/** Meta `user_data`: normalized, then hashed. Pure. */
export function hashedUserData(u: UserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const email = u.email?.trim().toLowerCase();
  if (email) out.em = [sha256(email)];
  const phone = u.phone?.replace(/\D/g, "");
  if (phone) out.ph = [sha256(phone)];
  const [first, ...rest] = (u.name ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (first) out.fn = [sha256(first)];
  if (rest.length > 0) out.ln = [sha256(rest[rest.length - 1]!)];
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  if (u.ip && u.ip !== "unknown") out.client_ip_address = u.ip;
  if (u.userAgent) out.client_user_agent = u.userAgent;
  return out;
}

export interface ServerEvent {
  /** GA4 name; the Meta name is derived. */
  name: "view_item" | "add_to_cart" | "begin_checkout" | "purchase" | "generate_lead";
  eventId: string;
  value: number;
  currency: string;
  items: { id: string; name?: string; price: number; quantity: number }[];
  url?: string;
  user: UserData;
}

const META_NAMES: Record<ServerEvent["name"], string> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
  generate_lead: "Lead",
};

export function serverAnalyticsOn(): { meta: boolean; ga4: boolean } {
  const e = env();
  return {
    meta: e.isProduction && Boolean(e.NEXT_PUBLIC_META_PIXEL_ID && e.META_CAPI_TOKEN),
    ga4: e.isProduction && Boolean(e.NEXT_PUBLIC_GA4_ID && e.GA4_API_SECRET),
  };
}

/** Pure: the JSON body for the Conversions API. */
export function metaPayload(event: ServerEvent, nowSeconds = Math.floor(Date.now() / 1000)) {
  return {
    data: [
      {
        event_name: META_NAMES[event.name],
        event_time: nowSeconds,
        event_id: event.eventId,
        action_source: "website",
        ...(event.url ? { event_source_url: event.url } : {}),
        user_data: hashedUserData(event.user),
        custom_data: {
          currency: event.currency,
          value: event.value,
          content_type: "product",
          content_ids: event.items.map((i) => i.id),
          contents: event.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
          ...(event.name === "purchase" ? { order_id: event.eventId } : {}),
        },
      },
    ],
  };
}

export async function sendServerEvent(event: ServerEvent, only?: "meta" | "ga4"): Promise<void> {
  const on = serverAnalyticsOn();
  const e = env();
  const jobs: Promise<unknown>[] = [];

  if (on.meta && only !== "ga4") {
    jobs.push(
      fetch(`https://graph.facebook.com/v21.0/${e.NEXT_PUBLIC_META_PIXEL_ID}/events?access_token=${e.META_CAPI_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaPayload(event)),
      }).then((r) => {
        if (!r.ok) console.error(`[analytics] meta ${event.name} → ${r.status}`);
      }),
    );
  }

  // GA4 needs the browser's client id to attach the event to a visit.
  if (on.ga4 && only !== "meta" && event.user.gaClientId) {
    jobs.push(
      fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${e.NEXT_PUBLIC_GA4_ID}&api_secret=${e.GA4_API_SECRET}`, {
        method: "POST",
        body: JSON.stringify({
          client_id: event.user.gaClientId,
          events: [
            {
              name: event.name,
              params: {
                currency: event.currency,
                value: event.value,
                ...(event.name === "purchase" ? { transaction_id: event.eventId } : {}),
                items: event.items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity })),
              },
            },
          ],
        }),
      }).then((r) => {
        if (!r.ok) console.error(`[analytics] ga4 ${event.name} → ${r.status}`);
      }),
    );
  }

  await Promise.allSettled(jobs);
}
