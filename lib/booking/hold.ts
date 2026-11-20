// HOW LONG AN UNPAID ORDER KEEPS A SLOT. Time is the stock of a service: an order nobody paid
// must not sit on an appointment for days. After the hold the seat is free again AT ONCE — the
// adapters stop counting it when they read, nothing has to run — and the order itself is
// cancelled by the usual clean-up (lib/orders/expiry.ts).

import { commerce } from "@/config/commerce";
import { env } from "@/lib/env";

/** BOOKING_HOLD_HOURS, or `commerce.booking.holdHours`. */
export function bookingHoldHours(): number {
  return env().BOOKING_HOLD_HOURS ?? commerce.booking.holdHours;
}
