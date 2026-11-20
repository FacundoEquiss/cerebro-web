import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { languageTag } from "@/i18n";
import { multiplyMoney, roundCents } from "@/lib/decimal";

const money = new Intl.NumberFormat(languageTag, {
  style: "currency",
  currency: brand.currency,
  maximumFractionDigits: 0,
});
const moneyWithCents = new Intl.NumberFormat(languageTag, { style: "currency", currency: brand.currency });

/** Price for people: no decimals when the amount is whole. */
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? money.format(amount) : moneyWithCents.format(amount);
}

/** Price as feeds and structured data want it: `1234.50`. */
export function plainPrice(amount: number): string {
  return amount.toFixed(2);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(languageTag, { dateStyle: "long" }).format(new Date(iso));
}

/** Rounds to cents, avoiding binary float drift (0.1 + 0.2). */
export function roundMoney(n: number): number {
  return roundCents(n);
}

/** Lowercase, no accents: for search and comparisons. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** "0,75 kg", "3 u" → "3": a quantity for people, with its unit of measure when it has one. */
export function formatQuantity(quantity: number, unit = "u"): string {
  const n = new Intl.NumberFormat(languageTag, { maximumFractionDigits: 3 }).format(quantity);
  return !unit || unit === "u" ? n : `${n} ${unit}`;
}

/** The amount of one order line, rounded to cents ON ITS OWN (the subtotal adds these). */
export function lineTotal(line: { unitPrice: number; quantity: number }): number {
  // Integer math, half up: the same cent PostgreSQL gives (lib/decimal.ts).
  return multiplyMoney(line.unitPrice, line.quantity);
}

/** "$ 12.000 / kg" for what is sold by weight or measure; the plain price for a piece. */
export function formatUnitPrice(amount: number, unit = "u"): string {
  return !unit || unit === "u" ? formatPrice(amount) : `${formatPrice(amount)} / ${unit}`;
}

/** "martes 3 de marzo, 10:30" — an appointment, always in the time zone of the store. */
export function formatSlot(start: string, options: { short?: boolean } = {}): string {
  return new Intl.DateTimeFormat(languageTag, {
    timeZone: commerce.booking.timeZone,
    weekday: options.short ? "short" : "long",
    day: "numeric",
    month: options.short ? "short" : "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(start));
}

/** "10:30" in the time zone of the store. */
export function formatSlotTime(start: string): string {
  return new Intl.DateTimeFormat(languageTag, { timeZone: commerce.booking.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(start));
}

/** One order line in words: "0,75 kg × Coffee (Ground) — martes 3 de marzo, 10:30". */
export function describeLine(line: { name: string; variantLabel: string; quantity: number; unit: string; slot: { start: string } | null }): string {
  return [
    `${formatQuantity(line.quantity, line.unit)} × ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ""}`,
    line.slot ? formatSlot(line.slot.start) : "",
  ].filter(Boolean).join(" — ");
}

/**
 * «sábado, 6 de marzo» → «Sábado, 6 de marzo». Only the FIRST letter: capitalising every word
 * (CSS `text-transform: capitalize`) turns «de marzo» into «De Marzo», which is wrong in Spanish.
 */
export function capitalFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase(languageTag) + text.slice(1);
}
