// COMMERCIAL RULES, IN ONE PLACE: shipping, minimums, instalments, lead times, manual payment.
// The product page, the cart, the checkout, the legal pages, the structured data and the feeds
// all read this file — a number that lives in two places is already wrong in one of them.
//
// ⚠ EVERYTHING BELOW IS AN EXAMPLE. Replace it with the real conditions of the business.

import type { Locale } from "../i18n/routes";

type Text = Record<Locale, string>;

export interface ShippingMethod {
  id: string;
  enabled: boolean;
  label: Text;
  detail: Text;
  /** Flat price in the store currency. The SERVER reads it; the browser only displays it. */
  price: number;
  /** Order subtotal from which this method is free. `null` = never free. */
  freeFrom: number | null;
  /** Whether the checkout asks for a street address. */
  requiresAddress: boolean;
}

export const commerce = {
  shipping: {
    methods: [
      {
        id: "pickup",
        enabled: true,
        label: { es: "Retiro en el local", en: "Store pickup" },
        detail: { es: "Te avisamos cuando esté listo. EJEMPLO: completá la dirección real.", en: "We'll let you know when it's ready. EXAMPLE: fill in the real address." },
        price: 0,
        freeFrom: null,
        requiresAddress: false,
      },
      {
        id: "delivery",
        enabled: true,
        label: { es: "Envío a domicilio", en: "Home delivery" },
        detail: { es: "Tarifa fija de EJEMPLO a todo el país.", en: "EXAMPLE flat rate, nationwide." },
        price: 6500,
        freeFrom: 90000,
        requiresAddress: true,
      },
    ] as ShippingMethod[],
  },

  /** Minimum order subtotal. 0 = no minimum. */
  minimumOrder: 0,
  /** Most units of one line the checkout accepts. */
  maxQuantityPerLine: 20,

  /** EXAMPLE — shown next to the price only when `enabled`. Never promise instalments you don't offer. */
  installments: { enabled: false, count: 3, interestFree: true },

  /** EXAMPLE — business days to prepare an order. The single source for every "ready in…" text. */
  leadTime: { minDays: 2, maxDays: 5 },

  /** Days the customer has to ask for a return. `null` = not defined yet (the store says nothing). */
  returnWindowDays: null as number | null,

  /** Options of the `manual` payment provider (the default one: no payment gateway needed). */
  manualPayment: {
    whatsapp: { enabled: true },
    bankTransfer: {
      enabled: true,
      /** FILL IN — shown on the order page after the purchase. */
      details: {
        es: ["Titular: COMPLETAR", "Banco: COMPLETAR", "Cuenta / alias: COMPLETAR"],
        en: ["Account holder: FILL IN", "Bank: FILL IN", "Account / alias: FILL IN"],
      } as Record<Locale, string[]>,
    },
  },
} as const;
