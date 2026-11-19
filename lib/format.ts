import { brand } from "@/config/brand";
import { languageTag } from "@/i18n";

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
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Lowercase, no accents: for search and comparisons. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
