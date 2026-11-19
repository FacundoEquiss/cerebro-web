import { languageTag, t, tr } from "@/i18n";
import { commerce } from "@/config/commerce";
import type { OrderStatus, PaymentMethod } from "@/lib/data/types";

const relative = new Intl.RelativeTimeFormat(languageTag, { numeric: "auto", style: "short" });
const dateTime = new Intl.DateTimeFormat(languageTag, { dateStyle: "medium", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat(languageTag, { day: "numeric", month: "short" });

/** "5 min ago", "2 h ago", "3 days ago". */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(Math.min(0, Math.round(seconds / 60)), "minute");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatShortDate = (iso: string) => shortDate.format(new Date(iso));

export const statusLabel = (status: OrderStatus) => t.admin.status[status];
export const paymentLabel = (method: PaymentMethod) => t.admin.paymentMethods[method];
export const shippingLabel = (methodId: string) => tr(commerce.shipping.methods.find((m) => m.id === methodId)?.label) || methodId;
