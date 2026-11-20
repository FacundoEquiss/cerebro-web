"use client";
// Day and time of a service. The days come from the server-rendered page (the opening hours of
// the store); the times of the chosen day are asked to /api/slots, which also says how many seats
// are left. Native controls only: a select for the day, radio buttons for the time.

import { useEffect, useState } from "react";
import { fill, languageTag, t } from "@/i18n";
import { capitalFirst } from "@/lib/format";
import styles from "./SlotPicker.module.css";

interface SlotOption {
  time: string;
  start: string;
  left: number;
}

const dayLabel = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return capitalFirst(new Intl.DateTimeFormat(languageTag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))));
};

export function SlotPicker({
  productId, timeZone, seats, value, onChange,
}: {
  productId: string;
  timeZone: string;
  seats: number;
  /** `YYYY-MM-DDTHH:MM` or "". */
  value: string;
  onChange: (slot: string) => void;
}) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The days that can be booked are asked when the page OPENS: a cached page never offers a day
  // that already passed.
  const [dates, setDates] = useState<string[] | null>(null);
  // An EVENT has fixed dates: they come with their seats in the same answer, and are a list.
  const [sessions, setSessions] = useState<{ slot: string; left: number }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/slots?product=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { dates: string[]; sessions?: { slot: string; left: number }[] }) => {
        if (!alive) return;
        setSessions(body.sessions ?? null);
        setDates(body.dates);
      })
      .catch(() => alive && setDates([]));
    return () => {
      alive = false;
    };
  }, [productId]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setSlots(null);
    setFailed(false);
    fetch(`/api/slots?product=${encodeURIComponent(productId)}&date=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { slots: SlotOption[] }) => alive && setSlots(body.slots))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [productId, date]);

  if (dates === null) return <p className="muted" data-testid="dates-loading">{t.types.slotsLoading}</p>;
  if (sessions) {
    if (sessions.length === 0) return <p className="notice" data-testid="no-dates">{t.types.eventNoDates}</p>;
    return (
      <fieldset className={`${styles.picker} ${styles.times}`} data-testid="slot-picker" data-event>
        <legend>{t.types.eventChoose}</legend>
        <div className={styles.sessions}>
          {sessions.map((s) => {
            const full = s.left < seats;
            const [day = "", time = ""] = s.slot.split("T");
            return (
              <label key={s.slot} className={styles.session} data-active={value === s.slot || undefined} data-off={full || undefined}>
                <input type="radio" name="slot" value={s.slot} checked={value === s.slot} disabled={full} onChange={() => onChange(s.slot)} className="sr-only" data-testid="session" />
                <strong>{dayLabel(day)} · {time}</strong>
                <span data-testid="session-left">{s.left === 0 ? t.types.slotFull : s.left === 1 ? t.types.seatsLeftOne : fill(t.types.seatsLeft, { n: s.left })}</span>
              </label>
            );
          })}
        </div>
        <p className={`muted ${styles.zone}`}>{fill(t.types.timeZoneNote, { zone: timeZone.split("/").pop()!.replace(/_/g, " ") })}</p>
      </fieldset>
    );
  }
  if (dates.length === 0) return <p className="notice" data-testid="no-dates">{t.types.noDates}</p>;

  return (
    <div className={styles.picker} data-testid="slot-picker">
      <div className="field">
        <label htmlFor="slot-date">{t.types.chooseDay}</label>
        <select
          id="slot-date"
          className="input"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            onChange("");
          }}
          data-testid="slot-date"
        >
          <option value="">—</option>
          {dates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
        </select>
      </div>

      {date ? (
        <fieldset className={styles.times} aria-live="polite">
          <legend>{t.types.chooseTime}</legend>
          {failed ? <p className="field-error">{t.types.slotsError}</p>
            : slots === null ? <p className="muted">{t.types.slotsLoading}</p>
            : slots.length === 0 ? <p className="muted">{t.types.noSlots}</p>
            : (
              <div className={styles.grid}>
                {slots.map((s) => {
                  const id = `${date}T${s.time}`;
                  const full = s.left < seats;
                  return (
                    <label key={s.time} className={styles.time} data-active={value === id || undefined} data-off={full || undefined}>
                      <input type="radio" name="slot" value={id} checked={value === id} disabled={full} onChange={() => onChange(id)} className="sr-only" data-testid={`slot-${s.time}`} />
                      <strong>{s.time}</strong>
                      <span>{full ? t.types.slotFull : fill(t.types.slotLeft, { n: s.left })}</span>
                    </label>
                  );
                })}
              </div>
            )}
        </fieldset>
      ) : null}
      <p className={`muted ${styles.zone}`}>{fill(t.types.timeZoneNote, { zone: timeZone.split("/").pop()!.replace(/_/g, " ") })}</p>
    </div>
  );
}
