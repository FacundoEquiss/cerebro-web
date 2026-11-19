"use client";
// The detail of one order: a side panel on a computer, a sheet from the bottom on a phone.
// It closes with its button, the backdrop or Escape — there is no drag-to-close gesture: on a
// sheet that scrolls, that gesture fights the scroll.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Mail, MessageCircle, Phone, Printer, X } from "lucide-react";
import { brand } from "@/config/brand";
import { fill, t } from "@/i18n";
import type { AdminOrder, OrderEvent, OrderStatus } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";
import { allowedMoves, ORDER_FLOW } from "@/lib/orders/status";
import { adminFetch } from "./api";
import { formatDateTime, paymentLabel, shippingLabel, statusLabel, timeAgo } from "./format";
import styles from "./OrderDetail.module.css";

const d = t.admin.detail;

function eventText(e: OrderEvent): string {
  switch (e.type) {
    case "created": return d.events.created;
    case "status": return fill(d.events.status, { from: e.from ? statusLabel(e.from) : "—", to: e.to ? statusLabel(e.to) : "—" }) + (e.text ? ` — ${e.text}` : "");
    case "payment": return fill(d.events.payment, { text: e.text });
    case "tracking": return fill(d.events.tracking, { text: e.text || "—" });
    default: return e.text;
  }
}

/** The message for the customer, written for the status the order is in. */
export function whatsappUrl(order: AdminOrder): string | null {
  const phone = order.customer.phone.replace(/\D/g, "");
  if (phone.length < 6) return null;
  const tracking = order.tracking ? fill(t.admin.whatsapp.trackingPart, { tracking: order.tracking }) : "";
  const text = fill(t.admin.whatsapp[order.status], { name: order.customer.name.split(" ")[0] ?? "", id: order.id, total: formatPrice(order.total), brand: brand.name, tracking });
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function OrderDetail({
  order, canWrite, now, startCancel, onClose, onMove, onChange,
}: {
  order: AdminOrder;
  canWrite: boolean;
  now: number;
  startCancel: boolean;
  onClose: () => void;
  onMove: (to: OrderStatus, reason?: string) => Promise<boolean>;
  onChange: (order: AdminOrder) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [cancelling, setCancelling] = useState(startCancel);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [tracking, setTracking] = useState(order.tracking ?? "");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Keep the focus inside the panel while it is open.
      if (e.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setTracking(order.tracking ?? ""), [order.id, order.tracking]);

  const moves = allowedMoves(order.status);
  const next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status) + 1];
  const primary = next && moves.includes(next) ? next : null;
  const others = moves.filter((m) => m !== primary && m !== "cancelled");
  const wa = whatsappUrl(order);
  const address = [order.customer.address, order.customer.city, order.customer.postalCode].filter(Boolean).join(", ");
  const source = [order.attribution.last_source ?? order.attribution.utm_source, order.attribution.last_medium ?? order.attribution.utm_medium].filter(Boolean).join(" / ");
  const notes = order.history.filter((e) => e.type === "note");

  async function act(body: Record<string, unknown>): Promise<boolean> {
    if (!canWrite) {
      setError(t.admin.orders.readOnly);
      return false;
    }
    setBusy(true);
    setError("");
    const result = await adminFetch<{ order?: AdminOrder }>(`/api/admin/orders/${encodeURIComponent(order.id)}`, { json: body });
    setBusy(false);
    if (result.ok && result.data.order) {
      onChange(result.data.order);
      return true;
    }
    setError(result.status === 403 ? t.admin.orders.readOnly : fill(t.admin.orders.moveFailed, { id: order.id }));
    return false;
  }

  async function submitCancel(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    if (await onMove("cancelled", reason.trim())) setCancelling(false);
  }

  async function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    if (await act({ action: "note", text: note.trim() })) setNote("");
  }

  async function copyTracking() {
    try {
      await navigator.clipboard.writeText(order.tracking ?? tracking);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <div className={styles.overlay} data-testid="order-detail">
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="detail-title" ref={panel}>
        <header className={styles.head}>
          <div>
            <h2 id="detail-title">{fill(d.title, { id: order.id })}</h2>
            <p className={styles.sub}>
              <span className={styles.status} data-status={order.status} data-testid="detail-status">{statusLabel(order.status)}</span>
              <time dateTime={order.createdAt} suppressHydrationWarning>{formatDateTime(order.createdAt)} · {timeAgo(order.createdAt, now)}</time>
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={d.close} ref={closeButton} data-testid="detail-close">
            <X aria-hidden />
          </button>
        </header>

        <div className={styles.body}>
          {!canWrite ? <p className={styles.notice}>{t.admin.readOnly}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {order.status === "cancelled" && order.history.some((e) => e.type === "payment" && e.from === "cancelled") ? (
            <p className={styles.error} role="alert" data-testid="detail-paid-while-cancelled">{t.admin.orders.paidWhileCancelledDetail}</p>
          ) : null}

          <section className={styles.actions} aria-label={d.changeStatus}>
            {primary ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void onMove(primary)} data-testid="detail-primary">
                <Check aria-hidden size={18} />
                {primary === "paid" ? d.confirmPayment : fill(d.nextStep, { status: statusLabel(primary) })}
              </button>
            ) : null}
            {others.map((m) => (
              <button key={m} type="button" className="btn btn-secondary" disabled={busy} onClick={() => void onMove(m)}>
                {fill(d.nextStep, { status: statusLabel(m) })}
              </button>
            ))}
            {wa ? (
              <a className="btn btn-secondary" href={wa} target="_blank" rel="noopener noreferrer" data-testid="detail-whatsapp">
                <MessageCircle aria-hidden size={18} /> {d.whatsapp}
              </a>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="detail-customer">
            <h3 id="detail-customer">{d.customer}</h3>
            <p className={styles.strong}>{order.customer.name}</p>
            <p className={styles.links}>
              <a href={`mailto:${order.customer.email}`}><Mail aria-hidden size={15} /> {order.customer.email}</a>
              <a href={`tel:${order.customer.phone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden size={15} /> {order.customer.phone}</a>
            </p>
            {order.customer.notes ? <p className={styles.quote}><span>{d.customerNotes}:</span> {order.customer.notes}</p> : null}
            {source ? <p className={styles.meta}>{d.source}: {source}</p> : null}
          </section>

          <section className={styles.section} aria-labelledby="detail-shipping">
            <h3 id="detail-shipping">{d.shipping}</h3>
            <p className={styles.strong}>{shippingLabel(order.shipping.methodId)}</p>
            {address ? <p>{address}</p> : null}
            <form
              className={styles.inline}
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "tracking", tracking });
              }}
            >
              <label htmlFor="detail-tracking" className="sr-only">{d.tracking}</label>
              <input id="detail-tracking" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={d.tracking} maxLength={200} data-testid="detail-tracking" />
              <button type="submit" className="btn btn-secondary" disabled={busy || tracking === (order.tracking ?? "")}>{d.trackingSave}</button>
              {order.tracking ? (
                <button type="button" className={styles.iconButton} onClick={copyTracking} aria-label={d.trackingCopy} title={d.trackingCopy}>
                  {copied ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
                </button>
              ) : null}
            </form>
            <span className="sr-only" aria-live="polite">{copied ? d.copied : ""}</span>
            <p className={styles.links}>
              <a href={`/admin/orders/${encodeURIComponent(order.id)}/print`} target="_blank" rel="noopener"><Printer aria-hidden size={15} /> {d.printSlip}</a>
              <a href={`/admin/orders/${encodeURIComponent(order.id)}/print?doc=label`} target="_blank" rel="noopener"><Printer aria-hidden size={15} /> {d.printLabel}</a>
            </p>
          </section>

          <section className={styles.section} aria-labelledby="detail-payment">
            <h3 id="detail-payment">{d.payment}</h3>
            <p className={styles.strong}>{paymentLabel(order.paymentMethod)} <span className={styles.meta}>· {order.paymentProvider}</span></p>
            <p className={styles.pay} data-paid={order.paidAt ? "yes" : "no"} data-testid="detail-payment-status">
              {order.paidAt ? fill(d.paidAt, { date: formatDateTime(order.paidAt) }) : d.notPaid}
            </p>
            {order.purchaseSentAt ? <p className={styles.meta}>{d.purchaseSent}</p> : null}
          </section>

          <section className={styles.section} aria-labelledby="detail-items">
            <h3 id="detail-items">{d.items}</h3>
            <ul className={styles.items}>
              {order.lines.map((l, i) => (
                <li key={i}>
                  {l.image ? <img src={l.image} alt="" width={44} height={55} loading="lazy" /> : <span />}
                  <span>
                    <strong>{l.name}</strong>
                    <span className={styles.meta}>{[l.variantLabel, `${l.quantity} × ${formatPrice(l.unitPrice)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={styles.amount}>{formatPrice(l.quantity * l.unitPrice)}</span>
                </li>
              ))}
            </ul>
            <dl className={styles.totals}>
              <div><dt>{t.cart.subtotal}</dt><dd>{formatPrice(order.subtotal)}</dd></div>
              <div><dt>{t.cart.shipping}</dt><dd>{order.shipping.price === 0 ? t.common.free : formatPrice(order.shipping.price)}</dd></div>
              <div className={styles.grand}><dt>{t.cart.total}</dt><dd>{formatPrice(order.total)}</dd></div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="detail-notes">
            <h3 id="detail-notes">{d.notes}</h3>
            {notes.length > 0 ? (
              <ul className={styles.notes}>
                {notes.map((n, i) => (
                  <li key={i}><p>{n.text}</p><span className={styles.meta}>{n.actor} · {formatDateTime(n.at)}</span></li>
                ))}
              </ul>
            ) : <p className={styles.meta}>{d.noNotes}</p>}
            <form className={styles.inline} onSubmit={submitNote}>
              <label htmlFor="detail-note" className="sr-only">{d.noteAdd}</label>
              <input id="detail-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={d.notePlaceholder} maxLength={1000} data-testid="detail-note" />
              <button type="submit" className="btn btn-secondary" disabled={busy || !note.trim()}>{d.noteAdd}</button>
            </form>
          </section>

          <section className={styles.section} aria-labelledby="detail-timeline">
            <h3 id="detail-timeline">{d.timeline}</h3>
            <ol className={styles.timeline} data-testid="detail-timeline">
              {order.history.filter((e) => e.type !== "note").map((e, i) => (
                <li key={i}>
                  <p>{eventText(e)}</p>
                  <span className={styles.meta}>{formatDateTime(e.at)} · {fill(d.by, { actor: e.actor })}</span>
                </li>
              ))}
            </ol>
          </section>

          {moves.includes("cancelled") ? (
            <section className={styles.section}>
              {cancelling ? (
                <form onSubmit={submitCancel} className={styles.cancel}>
                  <label htmlFor="detail-reason">{d.cancelReason}</label>
                  <textarea id="detail-reason" className="input" rows={2} value={reason} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(false); }} aria-invalid={reasonError || undefined} maxLength={300} data-testid="cancel-reason" />
                  {reasonError ? <p className="field-error">{d.cancelReasonRequired}</p> : null}
                  <div className={styles.inline}>
                    <button type="button" className="btn btn-secondary" onClick={() => setCancelling(false)}>{d.cancelBack}</button>
                    <button type="submit" className={`btn ${styles.danger}`} disabled={busy} data-testid="cancel-confirm">{d.cancelConfirm}</button>
                  </div>
                </form>
              ) : (
                <button type="button" className={styles.cancelLink} onClick={() => setCancelling(true)} data-testid="cancel-start">{d.cancel}</button>
              )}
            </section>
          ) : order.cancelReason ? (
            <section className={styles.section}><h3>{d.cancelReason}</h3><p>{order.cancelReason}</p></section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
