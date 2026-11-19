// THE ORDER PAGE. It opens with the signed receipt that travels in the URL (`?t=`), not with a
// cookie: that is what lets a buyer who paid inside the in-app browser of a social app — where
// cookies set a minute ago often do not come back — see their own order.

import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, MessageCircle, XCircle } from "lucide-react";
import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t, tr } from "@/i18n";
import { data } from "@/lib/data";
import type { Order } from "@/lib/data/types";
import { env } from "@/lib/env";
import { formatDate, formatPrice } from "@/lib/format";
import { verifyReceipt } from "@/lib/orders/receipt";
import { payments } from "@/lib/payments";
import styles from "./order.module.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[]; pay?: string | string[] }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  // Private page: never indexed, and its address (which carries the receipt) is never leaked.
  return { title: fill(t.order.title, { id }), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <div className="container page empty-state" data-testid="order-problem">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
      <Link href={paths.contact()} className="btn">{t.order.contactUs}</Link>
    </div>
  );
}

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const token = Array.isArray(query.t) ? query.t[0] : query.t;
  const e = env();
  const receipt = verifyReceipt(token, e.orderSecret);
  if (!receipt.ok) {
    return receipt.reason === "expired"
      ? <Problem title={t.order.expiredTitle} text={t.order.expiredText} />
      : <Problem title={t.order.invalidTitle} text={t.order.invalidText} />;
  }
  if (receipt.order.id !== id) return <Problem title={t.order.invalidTitle} text={t.order.invalidText} />;

  // The receipt proves the order is theirs; the database (if there is one) knows its status NOW.
  const adapter = await data();
  let order: Order = receipt.order;
  let confirming = false;
  try {
    order = (adapter.storesOrders ? await adapter.getOrder(id) : null) ?? receipt.order;
    if (order.status === "new" && order.paymentMethod === "online") {
      const payment = await payments().lookup?.(id, {});
      // Only money that really moved counts as "we are confirming it".
      confirming = payment?.status === "approved";
    }
  } catch (err) {
    // Degrade without breaking: the receipt alone is enough to show the order.
    console.error("[order-page]", err instanceof Error ? err.message : err);
  }

  const paid = order.paidAt !== null;
  const cancelled = order.status === "cancelled";
  // An online order nobody paid yet: the gateway failed, or the buyer closed its page. They can
  // open it again from here as many times as needed — it never creates a second order.
  const canPay = !paid && !cancelled && !confirming && order.paymentMethod === "online" && payments().id !== "manual";
  const payFailed = canPay && (Array.isArray(query.pay) ? query.pay[0] : query.pay) === "failed";
  const orderUrl = `${e.siteUrl}${paths.order(order.id, token)}`;
  const message = fill(t.order.whatsappMessage, { id: order.id, total: formatPrice(order.total), url: orderUrl });
  const whatsapp = brand.contact.whatsapp ? `https://wa.me/${brand.contact.whatsapp}?text=${encodeURIComponent(message)}` : null;
  const shipping = commerce.shipping.methods.find((m) => m.id === order.shipping.methodId);
  const statusLabel = cancelled ? t.order.statusCancelled : (t.order.status as Record<string, string>)[order.status] ?? order.status;

  return (
    <div className={`container page ${styles.page}`} data-testid="order-page">
      <header className={styles.head}>
        <span className={styles.icon} data-state={cancelled ? "cancelled" : paid ? "paid" : "pending"} aria-hidden>
          {cancelled ? <XCircle /> : paid ? <CheckCircle2 /> : <Clock />}
        </span>
        <p className="eyebrow">{fill(t.order.title, { id: order.id })}</p>
        <h1>{cancelled ? t.order.statusCancelled : paid ? t.order.statusPaid : canPay ? t.order.payTitle : t.order.thanks}</h1>
        <p className="muted">
          {cancelled ? t.order.cancelledDetail
            : confirming ? t.order.confirmingDetail
            : paid ? t.order.paidDetail
            : order.paymentMethod === "bank_transfer" ? t.order.nextStepsTransfer
            : order.paymentMethod === "whatsapp" ? t.order.nextStepsWhatsapp
            : t.order.payPending}
        </p>
      </header>

      {e.isDemo ? <p className="notice" data-testid="order-demo-note">{t.order.demoNote}</p> : null}

      {canPay ? (
        <form method="post" action="/api/orders/pay" className={`card ${styles.block}`} data-testid="pay-now-form">
          {payFailed ? <p className="notice" role="alert" data-testid="pay-failed">{t.order.payFailed}</p> : null}
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="t" value={token ?? ""} />
          <p><strong>{t.cart.total}: {formatPrice(order.total)}</strong></p>
          <button type="submit" className="btn btn-lg btn-block" data-testid="pay-now">{t.order.payNow}</button>
          <p className="muted">{t.checkout.inAppHint}</p>
        </form>
      ) : null}

      {!paid && !cancelled && order.paymentMethod === "bank_transfer" ? (
        <section className={`card ${styles.block}`} aria-labelledby="order-transfer">
          <h2 id="order-transfer">{t.order.transferData}</h2>
          <ul className={styles.transfer}>
            {commerce.manualPayment.bankTransfer.details[brand.locale].map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p><strong>{t.cart.total}: {formatPrice(order.total)}</strong></p>
          {whatsapp ? (
            <a href={whatsapp} className="btn btn-block" rel="noopener noreferrer" target="_blank" data-testid="order-whatsapp">
              <MessageCircle aria-hidden size={18} /> {t.order.sendProof}
            </a>
          ) : null}
        </section>
      ) : null}

      {!paid && !cancelled && order.paymentMethod === "whatsapp" && whatsapp ? (
        <a href={whatsapp} className="btn btn-lg btn-block" rel="noopener noreferrer" target="_blank" data-testid="order-whatsapp">
          <MessageCircle aria-hidden size={18} /> {t.order.sendWhatsapp}
        </a>
      ) : null}

      <section className={`card ${styles.block}`} aria-labelledby="order-items">
        <div className={styles.meta}>
          <div><span className="muted">{t.order.number}</span><strong data-testid="order-id">{order.id}</strong></div>
          <div><span className="muted">{t.order.date}</span><strong>{formatDate(order.createdAt)}</strong></div>
          <div><span className="muted">{t.order.statusTitle}</span><strong data-testid="order-status">{statusLabel}</strong></div>
        </div>
        {order.tracking ? <p className={styles.tracking}>{t.order.tracking}: <strong>{order.tracking}</strong></p> : null}
        <h2 id="order-items">{t.order.items}</h2>
        <ul className={styles.items}>
          {order.lines.map((l, i) => (
            <li key={i}>
              {l.image ? <img src={l.image} alt="" width={56} height={70} loading="lazy" /> : <span />}
              <span>
                <strong>{l.name}</strong>
                <span className="muted">{[l.variantLabel, fill(t.common.units, { n: l.quantity })].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="price">{formatPrice(l.unitPrice * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className={styles.totals}>
          <div><dt>{t.cart.subtotal}</dt><dd>{formatPrice(order.subtotal)}</dd></div>
          <div><dt>{t.cart.shipping}{shipping ? ` · ${tr(shipping.label)}` : ""}</dt><dd>{order.shipping.price === 0 ? t.common.free : formatPrice(order.shipping.price)}</dd></div>
          <div className={styles.total}><dt>{t.cart.total}</dt><dd data-testid="order-total">{formatPrice(order.total)}</dd></div>
        </dl>
        <p className="muted">{fill(t.order.leadTime, { min: commerce.leadTime.minDays, max: commerce.leadTime.maxDays })}</p>
      </section>

      <p className={`muted ${styles.keep}`}>{t.order.keepLink}</p>
      <Link href={paths.shop()} className="btn btn-secondary">{t.common.backToShop}</Link>
    </div>
  );
}
