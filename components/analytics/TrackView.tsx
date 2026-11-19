"use client";
import { useEffect } from "react";
import { brand } from "@/config/brand";
import { track, type EventItem, type EventName } from "@/lib/analytics/client";

/** Fires one e-commerce event when the page is seen (`view_item`, `begin_checkout`). */
export function TrackView({ name, items }: { name: EventName; items: EventItem[] }) {
  const key = items.map((i) => `${i.variantId ?? i.productId}x${i.quantity}`).join(",");
  useEffect(() => {
    if (items.length > 0) track(name, items, brand.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  return null;
}
