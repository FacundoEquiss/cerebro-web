// Public URL of every page, per locale. The filesystem routes under `app/` are always the
// English ones; for any other locale `next.config.ts` rewrites the localized path to the English
// route and 301-redirects the English path to the localized one, so each page has ONE public URL.
// This file must stay dependency-free: `next.config.ts` imports it.

export type Locale = "es" | "en";
export const LOCALES: readonly Locale[] = ["es", "en"];

export type RouteKey =
  | "shop" | "product" | "cart" | "checkout" | "order" | "search" | "contact"
  | "terms" | "privacy" | "returns";

/** The route as it exists in `app/` (also the public path when the locale is `en`). */
export const INTERNAL_ROUTES: Record<RouteKey, string> = {
  shop: "/shop",
  product: "/product",
  cart: "/cart",
  checkout: "/checkout",
  order: "/order",
  search: "/search",
  contact: "/contact",
  terms: "/terms",
  privacy: "/privacy",
  returns: "/returns",
};

export const LOCALIZED_ROUTES: Record<Locale, Record<RouteKey, string>> = {
  en: INTERNAL_ROUTES,
  es: {
    shop: "/tienda",
    product: "/producto",
    cart: "/carrito",
    checkout: "/checkout",
    order: "/pedido",
    search: "/buscar",
    contact: "/contacto",
    terms: "/terminos",
    privacy: "/privacidad",
    returns: "/cambios-y-devoluciones",
  },
};

/** Routes that have sub-paths (`/shop/[category]`, `/product/[slug]`, `/order/[id]`). */
export const ROUTES_WITH_CHILDREN: readonly RouteKey[] = ["shop", "product", "order"];
