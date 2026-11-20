// THE AGENDA: every reserved appointment, by day or by week, in the time zone of the store.
// A booking is a service line of an order that was not cancelled, so this page reads the orders
// through the adapter (`listBookings`) — there is no second calendar to keep in step.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { commerce } from "@/config/commerce";
import { fill, languageTag, t } from "@/i18n";
import { getSession } from "@/lib/admin/auth";
import { addDays, isEvent, serviceRules, slotsOn, upcomingSessions, wallTime, weekdayOf, zonedInstant } from "@/lib/booking/slots";
import { data } from "@/lib/data";
import type { Booking } from "@/lib/data/types";
import { expireStaleOrders } from "@/lib/orders/expiry";
import { capitalFirst, formatSlotTime } from "@/lib/format";
import styles from "./agenda.module.css";

export const metadata: Metadata = { title: t.admin.agenda.title };
export const dynamic = "force-dynamic";

const a = t.admin.agenda;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_START = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;

const dayTitle = (date: string, long = false) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return capitalFirst(new Intl.DateTimeFormat(languageTag, { weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))));
};

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  const query = await searchParams;
  const zone = commerce.booking.timeZone;
  const now = Date.now();
  const today = wallTime(now, zone).date;
  const view = query.view === "day" ? "day" : "week";
  const date = query.date && DATE.test(query.date) ? query.date : today;
  const first = view === "day" ? date : addDays(date, -WEEK_START[weekdayOf(date)]);
  const days = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDays(first, i));

  await expireStaleOrders();
  const adapter = await data();
  const from = zonedInstant(first, "00:00", zone).toISOString();
  const to = zonedInstant(addDays(days.at(-1)!, 1), "00:00", zone).toISOString();
  const [bookings, products] = await Promise.all([adapter.listBookings(from, to), adapter.listAllProducts()]);
  const services = products.filter((p) => p.type === "service" && p.active);

  const byDay = new Map<string, Booking[]>(days.map((d) => [d, []]));
  for (const b of bookings) byDay.get(wallTime(b.start, zone).date)?.push(b);

  /** Seats still free that day, across every service (only for days that can still be booked). */
  const free = (day: string) => {
    let seats = 0;
    for (const p of services) {
      const taken = new Map<string, number>();
      for (const b of byDay.get(day) ?? []) if (b.productId === p.id) taken.set(b.start, (taken.get(b.start) ?? 0) + b.seats);
      for (const s of slotsOn(p, day, now)) seats += Math.max(0, serviceRules(p).capacity - (taken.get(s.start) ?? 0));
    }
    return seats;
  };

  // The next date of an event that comes after the days on screen: one tap away, however far it is.
  const lastShown = days.at(-1)!;
  const nextEvent = services.filter(isEvent).flatMap((p) => upcomingSessions(p, now).filter((s) => s.date > lastShown).slice(0, 1).map((s) => ({ date: s.date, name: p.name }))).sort((x, y) => x.date.localeCompare(y.date))[0];

  const href = (v: string, d: string) => `/admin/agenda?view=${v}&date=${d}`;
  const stride = view === "day" ? 1 : 7;
  const title = view === "day" ? dayTitle(date, true) : `${dayTitle(days[0]!)} – ${dayTitle(days[6]!)}`;

  return (
    <div className={styles.agenda} data-testid="agenda" data-view={view}>
      <div className="admin-head">
        <h1>{a.title}</h1>
        <div className={styles.switch} role="group" aria-label={a.view}>
          <Link href={href("day", date)} aria-current={view === "day" ? "page" : undefined} data-testid="agenda-day">{a.day}</Link>
          <Link href={href("week", date)} aria-current={view === "week" ? "page" : undefined} data-testid="agenda-week">{a.week}</Link>
        </div>
      </div>

      <div className={styles.bar}>
        <Link href={href(view, addDays(first, -stride))} className={styles.arrow} aria-label={a.prev} data-testid="agenda-prev"><ChevronLeft aria-hidden /></Link>
        <strong className={styles.range} data-testid="agenda-range">{title}</strong>
        <Link href={href(view, addDays(first, stride))} className={styles.arrow} aria-label={a.next} data-testid="agenda-next"><ChevronRight aria-hidden /></Link>
        <Link href={href(view, today)} className="btn btn-secondary">{a.today}</Link>
        <form action="/admin/agenda" method="get" className={styles.jump}>
          <input type="hidden" name="view" value={view} />
          <label htmlFor="agenda-date" className="sr-only">{a.goTo}</label>
          <input id="agenda-date" className="input" type="date" name="date" defaultValue={date} required data-testid="agenda-date" />
          <button type="submit" className="btn btn-secondary" data-testid="agenda-go">{a.go}</button>
        </form>
        {nextEvent ? (
          <Link href={href(view, nextEvent.date)} className="btn btn-secondary" data-testid="agenda-next-event">
            <CalendarClock aria-hidden size={16} /> {fill(a.nextEvent, { name: nextEvent.name, date: dayTitle(nextEvent.date) })}
          </Link>
        ) : null}
        <span className={styles.count} data-testid="agenda-count">{bookings.length === 1 ? a.totalOne : fill(a.total, { n: bookings.length })}</span>
      </div>

      {services.length === 0 ? <p className="admin-banner" data-testid="agenda-none">{a.none}</p> : null}

      <ol className={styles.days} data-view={view}>
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const seats = free(day);
          return (
            <li key={day} className={styles.day} data-today={day === today || undefined} data-testid="agenda-day-column" data-date={day}>
              <h2>
                <Link href={href("day", day)}>{dayTitle(day, view === "day")}</Link>
                {seats > 0 ? <span className={styles.free}>{fill(a.free, { n: seats })}</span> : null}
              </h2>
              {list.length === 0 ? <p className={styles.empty}>{a.empty}</p> : (
                <ul className={styles.bookings}>
                  {list.map((b, i) => (
                    <li key={`${b.orderId}-${i}`}>
                      <a href={`/admin?order=${encodeURIComponent(b.orderId)}`} className={styles.booking} data-paid={b.paid ? "yes" : "no"} aria-label={fill(a.openOrder, { id: b.orderId })} data-testid="agenda-booking">
                        <span className={styles.time}><CalendarClock aria-hidden size={15} /> {formatSlotTime(b.start)}–{formatSlotTime(b.end)}</span>
                        <strong>{b.name}</strong>
                        <span className={styles.who}>{b.customerName}{b.seats > 1 ? ` · ${fill(a.seats, { n: b.seats })}` : ""}</span>
                        <span className={styles.tag}>{b.paid ? a.paid : a.unpaid} · <span className={styles.id}>{b.orderId}</span></span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <p className="admin-note">{fill(a.timeZone, { zone: zone.split("/").pop()!.replace(/_/g, " ") })}</p>
    </div>
  );
}
