// APPOINTMENTS. Pure and dependency-free: the product page (browser), the order door (server) and
// the tests all compute the slots of a service with these functions.
//
// Opening hours are written as wall time of ONE time zone (`commerce.booking.timeZone`); a slot is
// stored as the exact instant it starts and ends, so a visitor in another time zone, daylight
// saving changes and the server's own clock cannot move an appointment.

import { commerce } from "@/config/commerce";
import { OrderError, type EventRepeat, type Product, type ServiceSettings, type Slot, type Weekday, type WeeklyAvailability } from "@/lib/data/types";

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

/**
 * The instant at which the clocks of `timeZone` show `date` `time`. Always answers: for a wall
 * time that does not exist (the hour skipped when clocks go forward) it gives the instant right
 * after the jump — good for the edges of a day. To know whether a time really exists use `existingInstant`.
 */
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
  // A wall time the clocks skip: the rounds above land just BEFORE the jump. Step over it, to
  // the first instant whose clock is past what was asked (for 00:00, the first instant of that day).
  const p = parts(new Date(guess), timeZone);
  const behind = wanted - Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
  if (behind > 0) guess += behind;
  return new Date(guess);
}

/**
 * Like `zonedInstant`, but honest about daylight saving:
 *   · a wall time that does NOT exist that day (02:30 when clocks jump from 02:00 to 03:00, or
 *     00:30 in a zone that switches at midnight) → `null`: there is no such appointment;
 *   · a wall time that happens TWICE (clocks go back) → the FIRST of the two, always.
 */
export function existingInstant(date: string, time: string, timeZone: string): Date | null {
  const found = zonedInstant(date, time, timeZone);
  const shows = (at: number) => {
    const w = wallTime(at, timeZone);
    return w.date === date && w.time === time;
  };
  if (!shows(found.getTime())) return null;
  // Changes are of an hour (or half an hour in a few zones): look for an earlier twin.
  for (const back of [120, 60, 30]) {
    const earlier = found.getTime() - back * MINUTE;
    if (shows(earlier)) return new Date(earlier);
  }
  return found;
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

/** An event is a service with its own dates (a list, a rule that repeats, or both), even when none is left. */
export function isEvent(product: { service?: ServiceSettings | null; type?: string }): boolean {
  return Array.isArray(product.service?.sessions) || Boolean(product.service?.repeat);
}

const SESSION = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;
export const REPEAT_DEFAULT_COUNT = 3;
export const REPEAT_MAX_COUNT = 24;

export interface SessionSlot extends DaySlot {
  date: string;
  /** What the order sends: `YYYY-MM-DDTHH:MM`, wall time of the store. */
  slot: string;
}

const daysInMonth = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

/** True when `date` is the day a repeat rule names: «the 1st Saturday», «the last Friday», «every Tuesday». */
export function matchesRepeat(date: string, repeat: Pick<EventRepeat, "week" | "weekday">): boolean {
  if (weekdayOf(date) !== repeat.weekday) return false;
  const day = Number(date.slice(8, 10));
  if (repeat.week === "every") return true;
  if (repeat.week === "last") return day + 7 > daysInMonth(date);
  return Math.ceil(day / 7) === repeat.week;
}

const complained = new Set<string>();
/**
 * How many dates a rule keeps open. A value that is not a usable number (a catalogue edited by
 * hand: "3", null, -1, NaN) falls back to the default instead of silently giving NO dates, and
 * the log says so once.
 */
export function repeatCount(count: unknown): number {
  if (count === undefined) return REPEAT_DEFAULT_COUNT;
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) return Math.min(REPEAT_MAX_COUNT, Math.trunc(count));
  const key = String(count);
  if (!complained.has(key)) {
    complained.add(key);
    console.warn(`[booking] \`service.repeat.count\` is ${JSON.stringify(count) ?? key}: it must be a whole number from 1 to ${REPEAT_MAX_COUNT}. Using ${REPEAT_DEFAULT_COUNT}.`);
  }
  return REPEAT_DEFAULT_COUNT;
}

/** The next dates of a repeat rule, from today (wall time of the store), as session starts. */
export function repeatDates(repeat: EventRepeat | undefined, now: number, timeZone: string, blocked: readonly string[] = []): string[] {
  if (!repeat || !TIME.test(repeat.time ?? "") || !WEEKDAYS.includes(repeat.weekday)) return [];
  const count = repeatCount(repeat.count);
  const today = wallTime(now, timeZone).date;
  const out: string[] = [];
  // Two years of days is far more than any rule needs to give its dates.
  for (let i = 0; i < 740 && out.length < count; i++) {
    const date = addDays(today, i);
    if (!matchesRepeat(date, repeat) || blocked.includes(date)) continue;
    const start = existingInstant(date, repeat.time, timeZone);
    if (start && start.getTime() > now) out.push(`${date}T${repeat.time}`);
  }
  return out;
}

/**
 * The sessions of an event that have not started yet, in order: the dates of its list plus the
 * ones its repeat rule gives. A date written twice is one session. A CLOSED DAY WINS over both:
 * a day in `blockedDates` — the store's (`commerce.booking`) or the product's — has no session,
 * whether the rule gives it or the list names it.
 */
export function upcomingSessions(product: Pick<Product, "service">, now: number, defaults?: BookingRules): SessionSlot[] {
  const rules = serviceRules(product, defaults);
  const out = new Map<string, SessionSlot>();
  const add = (slot: string, minutesLong: number) => {
    const m = SESSION.exec(slot);
    if (!m || out.has(slot) || rules.blockedDates.includes(m[1]!)) return;
    const start = existingInstant(m[1]!, m[2]!, rules.timeZone);
    if (!start || start.getTime() <= now) return;
    out.set(slot, { date: m[1]!, time: m[2]!, slot, start: start.toISOString(), end: new Date(start.getTime() + minutesLong * MINUTE).toISOString() });
  };
  for (const session of product.service?.sessions ?? []) add(session.start ?? "", Math.max(5, Math.trunc(session.durationMinutes ?? rules.durationMinutes)));
  for (const slot of repeatDates(product.service?.repeat, now, rules.timeZone, rules.blockedDates)) add(slot, rules.durationMinutes);
  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
}

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
  // An event has its own dates: the weekly agenda, the closed days and the calendar window do not apply.
  if (isEvent(product)) return upcomingSessions(product, now, defaults).filter((s) => s.date === date);
  const rules = serviceRules(product, defaults);
  if (rules.blockedDates.includes(date)) return [];
  const today = wallTime(now, rules.timeZone).date;
  if (date < today || date > addDays(today, rules.maxDaysAhead)) return [];
  const out: DaySlot[] = [];
  for (const [from, to] of rules.weekly[weekdayOf(date)] ?? []) {
    if (!TIME.test(from) || !TIME.test(to)) continue;
    for (let at = minutes(from); at + rules.durationMinutes <= minutes(to); at += rules.durationMinutes) {
      const time = clock(at);
      // A time the clocks skip that day is not a slot.
      const start = existingInstant(date, time, rules.timeZone);
      if (!start) continue;
      if (start.getTime() < now + rules.minNoticeHours * 60 * MINUTE) continue;
      out.push({ time, start: start.toISOString(), end: new Date(start.getTime() + rules.durationMinutes * MINUTE).toISOString() });
    }
  }
  return out;
}

/** The days of the calendar window, from today, that have at least one slot left to book. */
export function openDates(product: Pick<Product, "service">, now: number, defaults?: BookingRules): string[] {
  if (isEvent(product)) return [...new Set(upcomingSessions(product, now, defaults).map((s) => s.date))];
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

/** A seat that is held: which product, from when to when, how many. */
export interface Held {
  productId: string;
  start: string;
  end: string;
  seats: number;
}

/**
 * Seats of a product already held during `[start, end)`. Bookings count when they OVERLAP the
 * range, not only when they start at the same minute: if the duration of a service changes, the
 * appointments taken with the old duration still block the time they occupy.
 */
export function seatsOverlapping(held: Held[], productId: string, start: string, end: string): number {
  const from = Date.parse(start);
  const to = Date.parse(end);
  let seats = 0;
  for (const h of held) if (h.productId === productId && Date.parse(h.start) < to && Date.parse(h.end) > from) seats += h.seats;
  return seats;
}
