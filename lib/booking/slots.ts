// APPOINTMENTS. Pure and dependency-free: the product page (browser), the order door (server) and
// the tests all compute the slots of a service with these functions.
//
// Opening hours are written as wall time of ONE time zone (`commerce.booking.timeZone`); a slot is
// stored as the exact instant it starts and ends, so a visitor in another time zone, daylight
// saving changes and the server's own clock cannot move an appointment.

import { commerce } from "@/config/commerce";
import { OrderError, type Product, type Slot, type Weekday, type WeeklyAvailability } from "@/lib/data/types";

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60_000;

export interface BookingRules {
  timeZone: string;
  weekly: WeeklyAvailability;
  blockedDates: readonly string[];
  minNoticeHours: number;
  maxDaysAhead: number;
}

export interface ServiceRules extends BookingRules {
  durationMinutes: number;
  capacity: number;
}

/** The rules of one service: its own settings on top of the store defaults. */
export function serviceRules(product: Pick<Product, "service">, defaults: BookingRules = commerce.booking): ServiceRules {
  const s = product.service;
  return {
    timeZone: defaults.timeZone,
    weekly: s?.weekly ?? defaults.weekly,
    blockedDates: [...defaults.blockedDates, ...(s?.blockedDates ?? [])],
    minNoticeHours: defaults.minNoticeHours,
    maxDaysAhead: defaults.maxDaysAhead,
    durationMinutes: Math.max(5, Math.trunc(s?.durationMinutes ?? 60)),
    capacity: Math.max(1, Math.trunc(s?.capacity ?? 1)),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(instant: Date, timeZone: string): Record<string, number> {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  return Object.fromEntries(f.formatToParts(instant).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall clock of `timeZone` at an instant: `{ date: "2026-03-04", time: "09:30" }`. */
export function wallTime(instant: Date | string | number, timeZone: string): { date: string; time: string } {
  const p = parts(new Date(instant), timeZone);
  return { date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`, time: `${pad(p.hour!)}:${pad(p.minute!)}` };
}

/** The instant at which the clocks of `timeZone` show `date` `time`. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  // Two rounds settle the offset even across a daylight-saving change.
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** `date` plus `days`, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

export interface DaySlot extends Slot {
  /** Wall time of the store: "09:30". */
  time: string;
}

/**
 * Every slot of a service on one day that can still be booked at `now` (enough notice, inside the
 * calendar window, not a closed day). Capacity is NOT looked at here: that needs the bookings.
 */
export function slotsOn(product: Pick<Product, "service">, date: string, now: number, defaults?: BookingRules): DaySlot[] {
  if (!DATE.test(date)) return [];
  const rules = serviceRules(product, defaults);
  if (rules.blockedDates.includes(date)) return [];
  const today = wallTime(now, rules.timeZone).date;
  if (date < today || date > addDays(today, rules.maxDaysAhead)) return [];
  const out: DaySlot[] = [];
  for (const [from, to] of rules.weekly[weekdayOf(date)] ?? []) {
    if (!TIME.test(from) || !TIME.test(to)) continue;
    for (let at = minutes(from); at + rules.durationMinutes <= minutes(to); at += rules.durationMinutes) {
      const time = clock(at);
      const start = zonedInstant(date, time, rules.timeZone);
      if (start.getTime() < now + rules.minNoticeHours * 60 * MINUTE) continue;
      out.push({ time, start: start.toISOString(), end: new Date(start.getTime() + rules.durationMinutes * MINUTE).toISOString() });
    }
  }
  return out;
}

/** The days of the calendar window, from today, that have at least one slot left to book. */
export function openDates(product: Pick<Product, "service">, now: number, defaults?: BookingRules): string[] {
  const rules = serviceRules(product, defaults);
  const today = wallTime(now, rules.timeZone).date;
  const out: string[] = [];
  for (let i = 0; i <= rules.maxDaysAhead; i++) {
    const date = addDays(today, i);
    if (slotsOn(product, date, now, defaults).length > 0) out.push(date);
  }
  return out;
}

/**
 * THE SERVER'S CHECK of a slot the browser sent (`YYYY-MM-DDTHH:MM`, wall time of the store): it
 * must be one of the slots this service really offers right now. Throws `OrderError` otherwise.
 */
export function resolveSlot(product: Pick<Product, "id" | "service">, slot: string | null | undefined, now: number, defaults?: BookingRules): Slot {
  if (!slot) throw new OrderError("slot_required", product.id);
  const [date = "", time = ""] = slot.split("T");
  const found = DATE.test(date) && TIME.test(time) ? slotsOn(product, date, now, defaults).find((s) => s.time === time) : undefined;
  if (!found) throw new OrderError("slot_invalid", product.id);
  return { start: found.start, end: found.end };
}

/** Seats already taken per slot start (ISO), from a list of bookings of ONE product. */
export function seatsTaken(bookings: { start: string; seats: number }[]): Map<string, number> {
  const taken = new Map<string, number>();
  for (const b of bookings) {
    const key = new Date(b.start).toISOString();
    taken.set(key, (taken.get(key) ?? 0) + b.seats);
  }
  return taken;
}
