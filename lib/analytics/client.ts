"use client";
// Browser side of the measurement. ONE function, `track()`, with the standard e-commerce event
// names; it fans out to whatever is loaded (GA4, Meta pixel) and mirrors the event to the
// server route so the Meta Conversions API receives it with the SAME `event_id` (the platform
// then counts one event, not two).
//
// `purchase` is NOT sent from here: the server sends it when the payment is confirmed.

import { analyticsConfigured, publicEnv } from "@/lib/public-env";
import { readConsent } from "./consent";

export type EventName = "view_item" | "add_to_cart" | "begin_checkout" | "contact";

export interface EventItem {
  productId: string;
  variantId?: string | null;
  name: string;
  price: number;
  quantity: number;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

const META_NAMES: Record<EventName, string> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  contact: "Contact",
};

export function analyticsAllowed(): boolean {
  return analyticsConfigured && readConsent() === "granted";
}

export function newEventId(): string {
  return crypto.randomUUID();
}

function cookie(name: string): string | undefined {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];
}

/** Ids the server needs to match its events with this browser. Empty without consent. */
export function browserIds(): Record<string, string> {
  if (!analyticsAllowed()) return {};
  const out: Record<string, string> = { consent: "granted" };
  const fbp = cookie("_fbp");
  const fbc = cookie("_fbc");
  const ga = cookie("_ga")?.split(".").slice(-2).join(".");
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  if (ga) out.ga_client_id = ga;
  return out;
}

export function track(name: EventName, items: EventItem[], currency: string): void {
  if (!analyticsAllowed()) return;
  const eventId = newEventId();
  const value = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  window.gtag?.("event", name === "contact" ? "generate_lead" : name, {
    currency,
    value,
    items: items.map((i) => ({ item_id: i.variantId ?? i.productId, item_name: i.name, price: i.price, quantity: i.quantity })),
  });

  if (publicEnv.metaPixelId) {
    window.fbq?.(
      "track",
      META_NAMES[name],
      { currency, value, content_type: "product", content_ids: items.map((i) => i.variantId ?? i.productId) },
      { eventID: eventId },
    );
    // Same event, same id, through the server. The server recomputes the value from the
    // catalogue: it does not trust the one calculated here.
    const body = JSON.stringify({
      name,
      eventId,
      url: window.location.origin + window.location.pathname,
      items: items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity })),
      ...browserIds(),
    });
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
}
