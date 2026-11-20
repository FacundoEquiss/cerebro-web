// TEST FIXTURE: a frozen copy of config/commerce.ts. The tests run against THIS file, never against
// the owner's configuration, so changing the real brand or the real commercial rules cannot
// break them. Change it only together with the tests that depend on its values.

// COMMERCIAL RULES, IN ONE PLACE: shipping, minimums, instalments, lead times, manual payment.
// The product page, the cart, the checkout, the legal pages, the structured data and the feeds
// all read this file — a number that lives in two places is already wrong in one of them.
//
// ⚠ EVERYTHING BELOW IS AN EXAMPLE. Replace it with the real conditions of the business.

import type { Locale } from "../../../i18n/routes";
import type { WeeklyAvailability } from "../../../lib/data/types";

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

  /**
   * EXAMPLE — defaults of the `service` products (appointments). Each product may override
   * `weekly` and add its own closed days; see docs/product-types.md.
   */
  booking: {
    /** IANA time zone the opening hours are written in. Slots are stored as exact instants. */
    timeZone: "America/Argentina/Buenos_Aires",
    /** Opening ranges per weekday. A day that is missing is closed. */
    weekly: {
      mon: [["09:00", "13:00"], ["14:00", "18:00"]],
      tue: [["09:00", "13:00"], ["14:00", "18:00"]],
      wed: [["09:00", "13:00"], ["14:00", "18:00"]],
      thu: [["09:00", "13:00"], ["14:00", "18:00"]],
      fri: [["09:00", "13:00"], ["14:00", "18:00"]],
      sat: [["09:00", "13:00"]],
    } as WeeklyAvailability,
    /** Closed days for every service (`YYYY-MM-DD`): holidays, vacations. */
    blockedDates: [] as string[],
    /** A slot cannot be booked with less notice than this. */
    minNoticeHours: 2,
    /** How far ahead the calendar opens. */
    maxDaysAhead: 30,
    /** Most appointments ONE order may contain: nobody books the whole week in one go. */
    maxSlotsPerOrder: 3,
    /** Most UNPAID appointments one buyer (by e-mail) may be holding at a time. */
    maxUnpaidPerBuyer: 3,
    /**
     * Hours an UNPAID order keeps its slot. After that the seat is free again at once (nothing has
     * to run for it), and the order is cancelled by the usual clean-up. Shorter than
     * ORDER_EXPIRY_HOURS on purpose: time is the stock of a service. The server variable
     * BOOKING_HOLD_HOURS overrides it.
     */
    holdHours: 12,
  },

  /** Downloads of the `digital` products. */
  digital: {
    /** Hours a download link works. The order page gives a fresh one while the order link is valid. */
    linkHours: 72,
  },

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
