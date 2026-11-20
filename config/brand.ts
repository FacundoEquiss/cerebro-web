// THE BRAND, IN ONE PLACE. Every visible name, contact detail and colour of the store comes from
// this file (or from `config/commerce.ts` and `content/`). Nothing here may import code that only
// runs in Next.js: `next.config.ts` and the scripts read it too.
//
// ⚠ EVERYTHING BELOW IS AN EXAMPLE. Replace it with the real, confirmed data of the business.
// Never invent a value: if you don't know it, leave it `null` and the store hides that piece.

import type { Locale } from "../i18n/routes";

export const brand = {
  /** Language of the store UI: "es" or "en". Dictionaries live in `i18n/`. */
  locale: "es" as Locale,

  /** EXAMPLE — the public name of the store. */
  name: "Tu Marca",
  /** EXAMPLE — one short line under the name. */
  tagline: {
    es: "Todo lo que vendés, en un solo lugar",
    en: "Everything you sell, in one place",
  },
  /** EXAMPLE — one or two sentences: what you sell and for whom. Used in meta tags and llms.txt. */
  description: {
    es: "Tienda de ejemplo con productos, descargas, turnos y trabajos a medida. Reemplazá este texto por lo que vende tu negocio.",
    en: "Example store with products, downloads, appointments and made-to-measure work. Replace this text with what your business sells.",
  },

  /** EXAMPLE — ISO 3166-1 country, ISO 4217 currency and BCP 47 tags used to format prices and dates. */
  country: "AR",
  currency: "ARS",
  languageTag: { es: "es-AR", en: "en-US" } as Record<Locale, string>,

  contact: {
    /** EXAMPLE. */
    email: "hola@example.com",
    /** EXAMPLE — digits only, with country code, as wa.me expects it. `null` hides WhatsApp. */
    whatsapp: "0000000000" as string | null,
    /** EXAMPLE — how the phone is shown to people. */
    phoneDisplay: "+00 000 000 0000" as string | null,
    /** Street address, only if customers can visit. `null` = online only. */
    address: null as string | null,
    /** EXAMPLE. */
    hours: { es: "Lunes a viernes de 9 a 18 h", en: "Monday to Friday, 9 am to 6 pm" } as Record<Locale, string> | null,
  },

  /** Official profiles (full URLs). They feed the footer and the `sameAs` of the structured data. */
  social: {
    instagram: "https://www.instagram.com/example" as string | null,
    facebook: null as string | null,
    tiktok: null as string | null,
    youtube: null as string | null,
  },

  /**
   * THE THEME. Change these eight values and the whole store follows: `app/layout.tsx` injects
   * them as CSS variables and `app/globals.css` derives everything else from them.
   */
  theme: {
    background: "#f7f6f3", // page background
    surface: "#ffffff", // cards, panels, drawers
    ink: "#17191c", // headings and main text
    muted: "#5d6269", // secondary text
    line: "#e4e2dc", // form fields and dividers
    action: "#1f4a40", // main buttons and links
    onAction: "#ffffff", // text on top of `action`
    highlight: "#b4532a", // sale prices and badges
  },
} as const;

export type Brand = typeof brand;
