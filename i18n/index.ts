// Tiny i18n: one dictionary per language, one active locale per deployment (`config/brand.ts`).
// No library, no runtime negotiation: the active dictionary is a plain object, so every text is
// in the server-rendered HTML. To add a language: copy `es.ts`, translate it, register it here
// and in `i18n/routes.ts`. TypeScript fails the build if a key is missing.

import { brand } from "@/config/brand";
import { es, type Dictionary } from "./es";
import { en } from "./en";
import { LOCALIZED_ROUTES, type Locale, type RouteKey } from "./routes";

export type { Locale, Dictionary };

const dictionaries: Record<Locale, Dictionary> = { es, en };

export const locale: Locale = brand.locale;
/** The active dictionary. */
export const t: Dictionary = dictionaries[locale];
export const languageTag: string = brand.languageTag[locale];

/** Picks the active language out of a `{ es, en }` text (or returns a plain string as is). */
export function tr(text: string | Partial<Record<Locale, string>> | null | undefined): string {
  if (text == null) return "";
  if (typeof text === "string") return text;
  return text[locale] ?? text.es ?? text.en ?? "";
}

/** Replaces `{name}` placeholders: `fill("Hola {name}", { name: "Ana" })`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
}

const routes = LOCALIZED_ROUTES[locale];

/** Public path of a page in the active locale. Always build links with this, never by hand. */
export function route(key: RouteKey, child?: string): string {
  return child ? `${routes[key]}/${encodeURIComponent(child)}` : routes[key];
}

export const paths = {
  home: () => "/",
  shop: () => route("shop"),
  category: (slug: string) => route("shop", slug),
  product: (slug: string) => route("product", slug),
  cart: () => route("cart"),
  checkout: () => route("checkout"),
  order: (id: string, token?: string) => `${route("order", id)}${token ? `?t=${token}` : ""}`,
  search: (q?: string) => `${route("search")}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  contact: () => route("contact"),
  terms: () => route("terms"),
  privacy: () => route("privacy"),
  returns: () => route("returns"),
};
