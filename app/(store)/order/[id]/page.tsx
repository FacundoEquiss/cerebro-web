// THE ORDER PAGE. It opens with the signed receipt that travels in the URL (`?t=`), not with a
// cookie: that is what lets a buyer who paid inside the in-app browser of a social app — where
// cookies set a minute ago often do not come back — see their own order.

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, Download, FileText, MessageCircle, XCircle } from "lucide-react";
import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t, tr } from "@/i18n";
import { data } from "@/lib/data";
import type { Order } from "@/lib/data/types";
import { env } from "@/lib/env";
import { needsShipping } from "@/lib/data/availability";
import { formatDate, formatPrice, formatQuantity, formatSlot, formatUnitPrice, lineTotal } from "@/lib/format";
import { canDownload, downloadPath } from "@/lib/orders/download";
import { verifyReceipt } from "@/lib/orders/receipt";
import { payments } from "@/lib/payments";
import styles from "./order.module.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[]; pay?: string | string[]; quote?: string | string[] }> };

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

  // Nothing to pay: an order that adds up to 0 (free products) is confirmed as it is.
  const free = order.status !== "quote" && order.total === 0;
  const paid = order.paidAt !== null;
  const cancelled = order.status === "cancelled";
  // An enquiry: no price until the owner SENDS the quote; then the customer can accept it here.
  const enquiry = order.status === "quote";
  const quoteSent = enquiry && Boolean(order.quote?.sentAt);
  const quoteFlag = Array.isArray(query.quote) ? query.quote[0] : query.quote;
  const quoteProblem = !enquiry ? null
    : quoteFlag === "changed" ? t.types.quoteChanged
    : quoteFlag === "not_sent" ? t.types.quoteNotSent
    : quoteFlag === "address" ? t.types.quoteAddressMissing
    : quoteFlag ? t.types.quoteUnavailable : null;
  const ships = needsShipping(order.lines);
  const slots = order.lines.filter((l) => l.slot);
  // The files of a digital line are handed over ONLY when the stored order is paid. Each link is
  // signed and expires; this page makes fresh ones every time it is opened.
  const digital = order.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.type === "digital");
  const downloads = canDownload(order) && adapter.storesOrders;
  const payMethods = payments().methods();
  // An online order nobody paid yet: the gateway failed, or the buyer closed its page. They can
  // open it again from here as many times as needed — it never creates a second order.
  const canPay = !paid && !free && !cancelled && !enquiry && !confirming && order.paymentMethod === "online" && payments().id !== "manual";
  const payFailed = canPay && (Array.isArray(query.pay) ? query.pay[0] : query.pay) === "failed";
  const orderUrl = `${e.siteUrl}${paths.order(order.id, token)}`;
  const message = fill(t.order.whatsappMessage, { id: order.id, total: formatPrice(order.total), url: orderUrl });
  const whatsapp = brand.contact.whatsapp ? `https://wa.me/${brand.contact.whatsapp}?text=${encodeURIComponent(message)}` : null;
  const shipping = commerce.shipping.methods.find((m) => m.id === order.shipping.methodId);
  const statusLabel = cancelled ? t.order.statusCancelled : (t.order.status as Record<string, string>)[order.status] ?? order.status;

  return (
    <div className={`container page ${styles.page}`} data-testid="order-page">
      <header className={styles.head}>
        <span className={styles.icon} data-state={cancelled ? "cancelled" : paid || free || quoteSent ? "paid" : "pending"} aria-hidden>
          {cancelled ? <XCircle /> : enquiry ? <FileText /> : paid || free ? <CheckCircle2 /> : <Clock />}
        </span>
        <p className="eyebrow">{fill(t.order.title, { id: order.id })}</p>
        <h1>{cancelled ? t.order.statusCancelled : quoteSent ? t.types.quoteReadyTitle : enquiry ? t.types.quoteReceivedTitle : free ? t.order.freeTitle : paid ? t.order.statusPaid : canPay ? t.order.payTitle : t.order.thanks}</h1>
        <p className="muted">
          {cancelled ? t.order.cancelledDetail
            : quoteSent ? t.types.quoteReadyText
            : enquiry ? t.types.quoteReceivedText
            : free ? t.order.freeDetail
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

      {!adapter.storesOrders && (enquiry || slots.length > 0 || digital.length > 0) ? (
        <p className="notice" data-testid="order-not-stored">{t.types.notStored}</p>
      ) : null}

      {quoteProblem ? <p className="notice" role="alert" data-testid="quote-problem">{quoteProblem}</p> : null}

      {quoteSent ? (
        // A plain form: it works without JavaScript and without cookies. `total` is what THIS page
        // shows — the server only accepts if it still equals the stored one.
        <form method="post" action="/api/quotes/accept" className={`card ${styles.block}`} data-testid="quote-accept-form">
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="t" value={token ?? ""} />
          <input type="hidden" name="total" value={order.total} />
          <p><strong>{t.cart.total}: <span data-testid="quote-total">{formatPrice(order.total)}</span></strong></p>
          {order.shipping.price > 0 ? (
            // The quote charges shipping: where it goes is part of accepting it.
            <fieldset className={styles.address} data-testid="quote-address">
              <legend>{t.types.quoteAddressTitle}</legend>
              <div className="field">
                <label htmlFor="quote-address-line">{t.checkout.address}</label>
                <input id="quote-address-line" name="address" className="input" required maxLength={200} autoComplete="street-address" data-testid="quote-address-line" />
              </div>
              <div className={styles.two}>
                <div className="field">
                  <label htmlFor="quote-address-city">{t.checkout.city}</label>
                  <input id="quote-address-city" name="city" className="input" required maxLength={120} autoComplete="address-level2" data-testid="quote-address-city" />
                </div>
                <div className="field">
                  <label htmlFor="quote-address-postal">{t.checkout.postalCode}</label>
                  <input id="quote-address-postal" name="postalCode" className="input" required maxLength={20} autoComplete="postal-code" data-testid="quote-address-postal" />
                </div>
              </div>
            </fieldset>
          ) : null}
          <fieldset className={styles.pay}>
            <legend>{t.types.quoteHowToPay}</legend>
            {payMethods.map((m, i) => (
              <label key={m}>
                <input type="radio" name="payment" value={m} defaultChecked={i === 0} data-testid={`quote-payment-${m}`} />
                {m === "online" ? t.checkout.payOnline : m === "whatsapp" ? t.checkout.payWhatsapp : t.checkout.payTransfer}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-lg btn-block" data-testid="quote-accept">{payMethods[0] === "online" ? t.types.quoteAcceptAndPay : t.types.quoteAccept}</button>
        </form>
      ) : null}

      {digital.length > 0 && !cancelled ? (
        <section className={`card ${styles.block}`} aria-labelledby="order-downloads" data-testid="order-downloads">
          <h2 id="order-downloads">{t.types.downloadsTitle}</h2>
          {downloads ? (
            <>
              <ul className={styles.downloads}>
                {digital.map(({ l, i }) => (
                  <li key={i}>
                    <span>{l.name}</span>
                    <a href={downloadPath(order.id, i, e.orderSecret, commerce.digital.linkHours)} className="btn btn-secondary" rel="nofollow" data-testid="download-link">
                      <Download aria-hidden size={18} /> {t.types.download}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="muted">{fill(t.types.downloadsNote, { hours: commerce.digital.linkHours })}</p>
            </>
          ) : <p className="muted" data-testid="downloads-pending">{t.types.downloadsAfterPayment}</p>}
        </section>
      ) : null}

      {slots.length > 0 && !cancelled ? (
        <section className={`card ${styles.block}`} aria-labelledby="order-slots" data-testid="order-slots">
          <h2 id="order-slots">{t.types.appointmentsTitle}</h2>
          <ul className={styles.slots}>
            {slots.map((l, i) => (
              <li key={i}>
                <CalendarClock aria-hidden size={20} />
                <span><strong data-testid="order-slot">{formatSlot(l.slot!.start)}</strong><span className="muted">{l.name}</span></span>
              </li>
            ))}
          </ul>
          <p className="muted">{t.types.appointmentsNote}</p>
        </section>
      ) : null}

      {!paid && !free && !cancelled && !enquiry && order.paymentMethod === "bank_transfer" ? (
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

      {!paid && !free && !cancelled && !enquiry && order.paymentMethod === "whatsapp" && whatsapp ? (
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
                <span className="muted">
                  {[
                    l.variantLabel,
                    l.unit === "u" ? fill(t.common.units, { n: l.quantity }) : `${formatQuantity(l.quantity, l.unit)} × ${formatUnitPrice(l.unitPrice, l.unit)}`,
                    l.slot ? formatSlot(l.slot.start, { short: true }) : "",
                  ].filter(Boolean).join(" · ")}
                </span>
                {l.note ? <span className={styles.request}><span className="muted">{t.types.requestDetail}:</span> {l.note}</span> : null}
              </span>
              <span className="price">{enquiry && !quoteSent ? t.types.toQuote : formatPrice(lineTotal(l))}</span>
            </li>
          ))}
        </ul>
        {enquiry && !quoteSent ? null : (
          <dl className={styles.totals}>
            <div><dt>{t.cart.subtotal}</dt><dd>{formatPrice(order.subtotal)}</dd></div>
            {ships || order.shipping.price > 0 ? (
              <div><dt>{t.cart.shipping}{shipping ? ` · ${tr(shipping.label)}` : ""}</dt><dd>{order.shipping.price === 0 ? t.common.free : formatPrice(order.shipping.price)}</dd></div>
            ) : null}
            <div className={styles.total}><dt>{t.cart.total}</dt><dd data-testid="order-total">{formatPrice(order.total)}</dd></div>
          </dl>
        )}
        {ships ? <p className="muted">{fill(t.order.leadTime, { min: commerce.leadTime.minDays, max: commerce.leadTime.maxDays })}</p> : null}
      </section>

      <p className={`muted ${styles.keep}`}>{t.order.keepLink}</p>
      <Link href={paths.shop()} className="btn btn-secondary">{t.common.backToShop}</Link>
    </div>
  );
}
