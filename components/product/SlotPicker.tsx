"use client";
// Day and time of a service. The days come from the server-rendered page (the opening hours of
// the store); the times of the chosen day are asked to /api/slots, which also says how many seats
// are left. Native controls only: a select for the day, radio buttons for the time.

import { useEffect, useState } from "react";
import { fill, languageTag, t } from "@/i18n";
import styles from "./SlotPicker.module.css";

interface SlotOption {
  time: string;
  start: string;
  left: number;
}

const dayLabel = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(languageTag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
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
  useEffect(() => {
    let alive = true;
    fetch(`/api/slots?product=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { dates: string[] }) => alive && setDates(body.dates))
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
