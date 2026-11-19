"use client";
// THE KANBAN: the screen an owner keeps open all day.
//
//  · New orders arrive on their own: a light poll every 15 s (it works with every data adapter),
//    with a counter in the tab title, an optional sound, a browser notification and a highlight.
//  · Moving a card: DRAG with a mouse; on a phone, the "Move to…" menu (a native <select>, the
//    most reliable control there is on touch screens) — touch dragging fights the scroll, so it
//    is not used; with a keyboard, Shift + arrows on a focused card, or the same menu.
//  · Every move goes to the server, which checks it and writes it to the order's timeline.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Bell, BellOff, Search, Volume2, VolumeX } from "lucide-react";
import { fill, t } from "@/i18n";
import type { AdminOrder, OrderStatus, PaymentMethod } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";
import { allowedMoves, canMove, neighbour, ORDER_FLOW } from "@/lib/orders/status";
import { adminFetch } from "./api";
import { paymentLabel, shippingLabel, statusLabel, timeAgo } from "./format";
import { OrderDetail } from "./OrderDetail";
import styles from "./OrdersBoard.module.css";

const POLL_MS = 15_000;
const a = t.admin.orders;

type Range = "all" | "today" | "7" | "30";

interface Drag {
  id: string;
  from: OrderStatus;
  x: number;
  y: number;
  width: number;
  offsetX: number;
  offsetY: number;
  over: OrderStatus | null;
}

/** Money arrived for an order that was already cancelled: a person has to review or refund it. */
export const paidWhileCancelled = (order: AdminOrder) =>
  order.status === "cancelled" && order.history.some((e) => e.type === "payment" && e.from === "cancelled");

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (frequency: number, start: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.3);
    };
    tone(880, 0);
    tone(1174, 0.16);
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // No audio available: the visual highlight is enough.
  }
}

export function OrdersBoard({ initial, initialVersion, serverNow, canWrite }: { initial: AdminOrder[]; initialVersion: string; serverNow: number; canWrite: boolean }) {
  const [orders, setOrders] = useState(initial);
  const [now, setNow] = useState(serverNow);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<PaymentMethod | "all">("all");
  const [range, setRange] = useState<Range>("all");
  const [sound, setSound] = useState(false);
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">("default");
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [startCancel, setStartCancel] = useState(false);

  const version = useRef(initialVersion);
  const known = useRef(new Set(initial.map((o) => o.id)));
  const soundRef = useRef(false);
  const dragStart = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const lastFocus = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // ---- preferences ----
  useEffect(() => {
    const on = localStorage.getItem("admin-sound") === "1";
    setSound(on);
    soundRef.current = on;
    setNotify("Notification" in window ? Notification.permission : "unsupported");
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    soundRef.current = next;
    localStorage.setItem("admin-sound", next ? "1" : "0");
    if (next) beep(); // also unlocks audio: browsers only allow sound after a user gesture
  };
  const askNotify = async () => {
    if (!("Notification" in window)) return;
    setNotify(await Notification.requestPermission());
  };

  // ---- live reception ----
  const sync = useCallback(async () => {
    const result = await adminFetch<{ unchanged?: boolean; version?: string; orders?: AdminOrder[] }>(`/api/admin/orders?v=${encodeURIComponent(version.current)}`);
    setOnline(result.ok);
    if (!result.ok || result.data.unchanged || !result.data.orders) return;
    version.current = result.data.version ?? "";
    const arrived = result.data.orders.filter((o) => !known.current.has(o.id));
    for (const o of result.data.orders) known.current.add(o.id);
    setOrders(result.data.orders);
    if (arrived.length > 0) {
      setFresh((prev) => new Set([...prev, ...arrived.map((o) => o.id)]));
      if (soundRef.current) beep();
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        const first = arrived[0]!;
        const body = arrived.length === 1 ? `${first.id} · ${first.customer.name} · ${formatPrice(first.total)}` : fill(a.newOrders, { n: arrived.length });
        try {
          new Notification(a.newOrder, { body, tag: "new-order" });
        } catch {}
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void sync(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  // The counter in the tab: how many orders arrived and were not looked at yet.
  useEffect(() => {
    const base = `${a.title} · ${t.admin.title}`;
    document.title = fresh.size > 0 ? `(${fresh.size}) ${base}` : base;
  }, [fresh]);

  // ---- filters ----
  const visible = useMemo(() => {
    const words = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
    const day = 86_400_000;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const since = range === "all" ? 0 : range === "today" ? start.getTime() : start.getTime() - (Number(range) - 1) * day;
    return orders.filter((o) => {
      if (payment !== "all" && o.paymentMethod !== payment) return false;
      if (Date.parse(o.createdAt) < since) return false;
      if (words.length === 0) return true;
      const haystack = `${o.id} ${o.customer.name} ${o.customer.email} ${o.customer.phone}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [orders, query, payment, range, now]);

  const byStatus = (status: OrderStatus) => visible.filter((o) => o.status === status);
  const current = selected ? orders.find((o) => o.id === selected) ?? null : null;

  // ---- moving ----
  const replace = (order: AdminOrder) => setOrders((list) => list.map((o) => (o.id === order.id ? order : o)));

  async function move(order: AdminOrder, to: OrderStatus, reason?: string): Promise<boolean> {
    if (order.status === to) return true;
    if (!canMove(order.status, to)) {
      setMessage(a.invalidMove);
      return false;
    }
    if (!canWrite) {
      setMessage(a.readOnly);
      return false;
    }
    replace({ ...order, status: to }); // optimistic: the card moves at once
    const result = await adminFetch<{ order?: AdminOrder }>(`/api/admin/orders/${encodeURIComponent(order.id)}`, { json: { action: "move", to, reason } });
    if (result.ok && result.data.order) {
      replace(result.data.order);
      setMessage(fill(a.moved, { id: order.id, status: statusLabel(to) }));
      return true;
    }
    replace(order);
    setMessage(result.status === 409 ? a.conflict : result.status === 403 ? a.readOnly : result.status === 422 ? a.invalidMove : fill(a.moveFailed, { id: order.id }));
    if (result.status === 409) void sync();
    return false;
  }

  function requestMove(order: AdminOrder, to: OrderStatus) {
    if (to === "cancelled") {
      // Cancelling needs a reason: it is written in the detail panel.
      setStartCancel(true);
      open(order.id);
      return;
    }
    void move(order, to);
  }

  function open(id: string, from?: HTMLElement | null) {
    lastFocus.current = from ?? (document.activeElement as HTMLElement | null);
    setSelected(id);
    setFresh((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  function close() {
    setSelected(null);
    setStartCancel(false);
    lastFocus.current?.focus?.();
  }

  // ---- drag with a mouse (touch never starts a drag: it would fight the scroll) ----
  function onPointerDown(e: ReactPointerEvent<HTMLElement>, order: AdminOrder) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("select, a, button")) return;
    dragStart.current = { id: order.id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLElement>, order: AdminOrder) {
    const start = dragStart.current;
    if (!start || start.id !== order.id) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!start.moved) {
      start.moved = true;
      setDrag({ id: order.id, from: order.status, x: e.clientX, y: e.clientY, width: rect.width, offsetX: start.x - rect.left, offsetY: start.y - rect.top, over: null });
      return;
    }
    // Which column is under the pointer? Measured from the columns' boxes, so the card that
    // travels with the pointer never gets in the way.
    const column = Array.from(document.querySelectorAll<HTMLElement>("[data-column]")).find((c) => {
      const box = c.getBoundingClientRect();
      return e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top - 40;
    });
    const over = (column?.dataset.column as OrderStatus | undefined) ?? null;
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over } : d));
    // Near a side edge: scroll the board.
    const board = scroller.current;
    if (board) {
      const box = board.getBoundingClientRect();
      if (e.clientX > box.right - 60) board.scrollLeft += 14;
      else if (e.clientX < box.left + 60) board.scrollLeft -= 14;
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLElement>, order: AdminOrder) {
    const start = dragStart.current;
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start?.moved) return;
    suppressClick.current = true; // the click that follows a drag must not open the order
    setTimeout(() => (suppressClick.current = false), 0);
    const over = drag?.over;
    setDrag(null);
    if (over && over !== order.status) requestMove(order, over);
  }

  function onCardKey(e: KeyboardEvent<HTMLElement>, order: AdminOrder) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(order.id, e.currentTarget);
    } else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const to = neighbour(order.status, e.key === "ArrowRight" ? 1 : -1);
      if (to) void move(order, to);
      else setMessage(a.invalidMove);
    }
  }

  const card = (order: AdminOrder) => {
    const items = order.lines.reduce((n, l) => n + l.quantity, 0);
    const moves = allowedMoves(order.status);
    const dragging = drag?.id === order.id;
    return (
      <li key={order.id}>
        <article
          className={styles.card}
          data-testid="order-card"
          data-order={order.id}
          data-fresh={fresh.has(order.id) || undefined}
          data-dragging={dragging || undefined}
          style={dragging ? { position: "fixed", left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width } : undefined}
          tabIndex={0}
          role="button"
          aria-label={fill(a.open, { id: order.id })}
          aria-keyshortcuts="Shift+ArrowRight Shift+ArrowLeft"
          onClick={(e) => {
            if (suppressClick.current || (e.target as HTMLElement).closest("select")) return;
            open(order.id, e.currentTarget);
          }}
          onKeyDown={(e) => onCardKey(e, order)}
          onPointerDown={(e) => onPointerDown(e, order)}
          onPointerMove={(e) => onPointerMove(e, order)}
          onPointerUp={(e) => onPointerUp(e, order)}
          onPointerCancel={() => {
            dragStart.current = null;
            setDrag(null);
          }}
        >
          <header className={styles.cardHead}>
            <span className={styles.id}>{order.id}</span>
            {fresh.has(order.id) ? <span className={styles.newBadge}>{a.newBadge}</span> : null}
            <time dateTime={order.createdAt} className={styles.ago} suppressHydrationWarning>{timeAgo(order.createdAt, now)}</time>
          </header>
          <p className={styles.customer}>{order.customer.name}</p>
          <p className={styles.line}>
            <strong className={styles.total}>{formatPrice(order.total)}</strong>
            <span>{items === 1 ? a.itemOne : fill(a.items, { n: items })}</span>
          </p>
          <p className={styles.tags}>
            <span className={styles.tag} data-paid={order.paidAt ? "yes" : "no"}>
              {paymentLabel(order.paymentMethod)} · {order.paidAt ? a.paid : a.unpaid}
            </span>
            <span className={styles.tag}>{shippingLabel(order.shipping.methodId)}</span>
          </p>
          {paidWhileCancelled(order) ? <p className={styles.alert} data-testid="paid-while-cancelled">{a.paidWhileCancelled}</p> : null}
          {moves.length > 0 ? (
            <select
              className={styles.move}
              value=""
              aria-label={fill(a.moveLabel, { id: order.id })}
              data-testid="move-select"
              onChange={(e) => {
                const to = e.target.value as OrderStatus;
                e.target.value = "";
                if (to) requestMove(order, to);
              }}
            >
              <option value="">{a.moveTo}</option>
              {moves.map((m) => (
                <option key={m} value={m}>{m === "cancelled" ? a.cancelOption : statusLabel(m)}</option>
              ))}
            </select>
          ) : null}
        </article>
        {dragging ? <div className={styles.placeholder} style={{ height: 96 }} aria-hidden /> : null}
      </li>
    );
  };

  const cancelled = byStatus("cancelled");

  return (
    <div className={styles.board} data-dragging={drag ? "" : undefined}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{a.title}</h1>
        <label className={styles.search}>
          <Search aria-hidden size={16} />
          <span className="sr-only">{a.search}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={a.search} data-testid="orders-search" />
        </label>
        <select className={styles.control} value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod | "all")} aria-label={a.payment} data-testid="orders-payment">
          <option value="all">{a.allPayments}</option>
          {(["bank_transfer", "whatsapp", "online"] as const).map((m) => <option key={m} value={m}>{paymentLabel(m)}</option>)}
        </select>
        <select className={styles.control} value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label={a.range} data-testid="orders-range">
          <option value="all">{a.rangeAll}</option>
          <option value="today">{a.rangeToday}</option>
          <option value="7">{a.range7}</option>
          <option value="30">{a.range30}</option>
        </select>
        <span className={styles.live} data-online={online || undefined} data-testid="live-indicator">
          <span className={styles.pulse} aria-hidden /> {online ? a.live : a.offline}
        </span>
        <button type="button" className={styles.iconButton} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? a.soundOn : a.soundOff} title={sound ? a.soundOn : a.soundOff} data-testid="sound-toggle">
          {sound ? <Volume2 aria-hidden size={18} /> : <VolumeX aria-hidden size={18} />}
        </button>
        {notify !== "unsupported" ? (
          <button type="button" className={styles.iconButton} onClick={askNotify} aria-pressed={notify === "granted"} disabled={notify === "denied"} aria-label={notify === "granted" ? a.notifyOn : notify === "denied" ? a.notifyBlocked : a.notify} title={notify === "granted" ? a.notifyOn : notify === "denied" ? a.notifyBlocked : a.notify}>
            {notify === "granted" ? <Bell aria-hidden size={18} /> : <BellOff aria-hidden size={18} />}
          </button>
        ) : null}
      </div>

      <nav className={styles.jump} aria-label={a.columns}>
        {ORDER_FLOW.map((status) => (
          <button key={status} type="button" data-status={status} onClick={() => document.getElementById(`column-${status}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}>
            {statusLabel(status)} <span>{byStatus(status).length}</span>
          </button>
        ))}
      </nav>

      <p className="sr-only">{a.dragHint}</p>
      <div className={styles.columns} ref={scroller} data-testid="kanban">
        {ORDER_FLOW.map((status) => {
          const list = byStatus(status);
          const droppable = drag ? drag.from !== status && canMove(drag.from, status) : false;
          return (
            <section
              key={status}
              id={`column-${status}`}
              className={styles.column}
              data-column={status}
              data-status={status}
              data-testid={`column-${status}`}
              data-drop={drag ? (droppable ? "yes" : drag.from === status ? "self" : "no") : undefined}
              data-over={drag?.over === status && droppable ? "" : undefined}
              aria-labelledby={`column-title-${status}`}
            >
              <header className={styles.columnHead}>
                <span className={styles.dot} aria-hidden />
                <h2 id={`column-title-${status}`}>{statusLabel(status)}</h2>
                <span className={styles.count} data-testid={`count-${status}`}>{list.length}</span>
              </header>
              {list.length > 0 ? <ul className={styles.cards}>{list.map(card)}</ul> : <p className={styles.empty}>{a.empty}</p>}
            </section>
          );
        })}
      </div>

      {cancelled.length > 0 ? (
        <details className={styles.cancelled} data-testid="cancelled-fold">
          <summary>{fill(a.cancelledFold, { n: cancelled.length })}</summary>
          <ul className={styles.cancelledList}>{cancelled.map(card)}</ul>
        </details>
      ) : null}

      <p className={styles.toast} role="status" aria-live="polite" data-testid="board-message" data-show={message ? "" : undefined} onAnimationEnd={() => setMessage("")} key={message}>
        {message}
      </p>

      {current ? (
        <OrderDetail
          order={current}
          canWrite={canWrite}
          now={now}
          startCancel={startCancel}
          onClose={close}
          onMove={(to, reason) => move(current, to, reason)}
          onChange={replace}
        />
      ) : null}
    </div>
  );
}
