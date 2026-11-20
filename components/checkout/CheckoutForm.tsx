"use client";
// The checkout: buyer's data → delivery → payment → confirm. What matters here:
//   · the browser sends ids and quantities; the total on screen is an estimate the server replaces;
//   · one attempt = one idempotency key, so a double tap or a retry never creates two orders;
//   · the antibot token is single-use: after a failed submit the form waits for a fresh one.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { brand } from "@/config/brand";
import { fill, languageTag, paths, t } from "@/i18n";
import { readAttribution } from "@/lib/analytics/attribution";
import { browserIds, track } from "@/lib/analytics/client";
import { resolveLine, slotLabel, type CartProduct } from "@/lib/cart-catalog";
import { needsShipping } from "@/lib/data/availability";
import type { PaymentMethod } from "@/lib/data/types";
import { formatPrice, formatQuantity, lineTotal } from "@/lib/format";
import { idempotencyKey } from "@/lib/orders/idempotency";
import { customerSchema, type CustomerField } from "@/lib/orders/schema";
import { checkoutSeed, clearCheckoutSeed } from "@/stores/checkout-attempt";
import { useCart } from "@/stores/cart";
import { AntibotWidget } from "./AntibotWidget";
import styles from "./CheckoutForm.module.css";

interface ShippingOption {
  id: string;
  label: string;
  detail: string;
  price: number;
  freeFrom: number | null;
  requiresAddress: boolean;
}

const PAYMENT_TEXT: Record<PaymentMethod, { label: string; detail: string }> = {
  whatsapp: { label: t.checkout.payWhatsapp, detail: t.checkout.payWhatsappDetail },
  bank_transfer: { label: t.checkout.payTransfer, detail: t.checkout.payTransferDetail },
  online: { label: t.checkout.payOnline, detail: t.checkout.payOnlineDetail },
};

type Errors = Partial<Record<CustomerField, string>>;
const ERRORS = t.checkout.errors as Record<string, string>;

export function CheckoutForm({
  catalog, shipping, paymentMethods, antibot,
}: {
  catalog: CartProduct[];
  shipping: ShippingOption[];
  paymentMethods: PaymentMethod[];
  antibot: string;
}) {
  const router = useRouter();
  const { lines, hydrated, clear } = useCart();
  const [shippingId, setShippingId] = useState(shipping[0]?.id ?? "");
  const [payment, setPayment] = useState<PaymentMethod>(paymentMethods[0] ?? "bank_transfer");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [unpaidOrderUrl, setUnpaidOrderUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const needsToken = antibot !== "none";

  const items = useMemo(() => lines.flatMap((l) => resolveLine(l, catalog) ?? []), [lines, catalog]);
  // THE CHECKOUT ADAPTS TO THE CART: delivery is asked only if something in it is shipped.
  const ships = needsShipping(items);
  const mixed = ships && items.some((i) => i.type !== "physical");
  const method = ships ? (shipping.find((m) => m.id === shippingId) ?? shipping[0]) : undefined;
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);
  const shippingPrice = method ? (method.freeFrom !== null && subtotal >= method.freeFrom ? 0 : method.price) : 0;
  // Free products only: there is nothing to pay, so no way of paying is asked (the server confirms the order at once).
  const nothingToPay = items.length > 0 && subtotal + shippingPrice === 0;

  useEffect(() => {
    if (hydrated && items.length > 0) {
      track("begin_checkout", items.map((i) => ({ productId: i.productId, variantId: i.variantId, name: i.name, price: i.unitPrice, quantity: i.quantity })), brand.currency);
    }
    // Once per visit to the checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (unpaidOrderUrl) {
    return (
      <div className="empty-state" data-testid="checkout-payment-error">
        <p className="notice" role="alert">{formError}</p>
        <Link href={unpaidOrderUrl} className="btn btn-lg" data-testid="go-to-order">{t.checkout.goToOrder}</Link>
      </div>
    );
  }
  if (!hydrated) return <div className="skeleton" style={{ height: 420 }} role="status" aria-label={t.common.loading} />;
  if (items.length === 0 && !done) {
    return (
      <div className="empty-state">
        <p className="muted">{t.cart.empty}</p>
        <Link href={paths.shop()} className="btn">{t.cart.emptyCta}</Link>
      </div>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || (ships && !method)) return;
    const form = new FormData(e.currentTarget);
    const raw = Object.fromEntries(["name", "email", "phone", "address", "city", "postalCode", "notes"].map((k) => [k, String(form.get(k) ?? "").trim() || undefined]));
    const parsed = customerSchema.safeParse(raw);
    const next: Errors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[issue.path[0] as CustomerField] ??= ERRORS[String(issue.path[0])] ?? ERRORS.generic;
    if (method?.requiresAddress) {
      for (const k of ["address", "city", "postalCode"] as const) if (!raw[k]) next[k] = ERRORS[k];
    }
    setErrors(next);
    setFormError("");
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    if (needsToken && !token) {
      setFormError(t.checkout.antibotWaiting);
      return;
    }

    setSending(true);
    const orderLines = items.map((i) => ({ productId: i.productId, variantId: i.variantId, selection: i.selection, quantity: i.quantity, ...(i.slot ? { slot: i.slot } : {}) }));
    const methodId = method?.id ?? "none";
    try {
      const key = await idempotencyKey({ seed: checkoutSeed(), lines: orderLines, customer: parsed.data!, shippingMethodId: methodId, paymentMethod: payment });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: key,
          lines: orderLines,
          customer: parsed.data,
          shippingMethodId: methodId,
          paymentMethod: payment,
          antibotToken: token ?? undefined,
          attribution: { ...readAttribution(), ...browserIds() },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; redirect?: string | null; paymentError?: boolean; error?: string; field?: string; detail?: string };
      if (!response.ok || !body.url) {
        setFormError(body.error === "invalid" && body.field ? (ERRORS[body.field] ?? ERRORS.generic!) : fill(ERRORS[body.error ?? "generic"] ?? ERRORS.generic!, { detail: body.detail ?? "" }));
        // The token was spent by this attempt: get a new one before the next.
        setResetSignal((n) => n + 1);
        setSending(false);
        return;
      }
      setDone(true);
      clear();
      clearCheckoutSeed();
      if (body.paymentError) {
        // The order exists but the gateway did not open: say so HERE, and point to the order
        // page, where "Pay now" tries again. Never pretend the payment is on its way.
        setUnpaidOrderUrl(body.url);
        setFormError(ERRORS.payment_start!);
        setSending(false);
        return;
      }
      if (body.redirect) window.location.assign(body.redirect);
      else router.push(body.url);
    } catch {
      // Network failure: the same key is re-used on retry, so no duplicate order.
      setFormError(ERRORS.network!);
      setResetSignal((n) => n + 1);
      setSending(false);
    }
  }

  const field = (name: CustomerField, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`field-${name}`}>{label}</label>
      <input
        id={`field-${name}`}
        name={name}
        className="input"
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? `error-${name}` : undefined}
        data-testid={`checkout-${name}`}
        {...props}
      />
      {errors[name] ? <p id={`error-${name}`} className="field-error">{errors[name]}</p> : null}
    </div>
  );

  const submitLabel = sending ? t.checkout.sending : payment === "online" ? t.checkout.confirmAndPay : t.checkout.confirm;

  return (
    <form onSubmit={submit} noValidate className={styles.layout} data-testid="checkout-form">
      <div className={styles.steps}>
        <section className={`card ${styles.block}`} aria-labelledby="checkout-contact">
          <h2 id="checkout-contact">{t.checkout.contact}</h2>
          {field("name", t.checkout.name, { autoComplete: "name", required: true })}
          <div className={styles.two}>
            {field("email", t.checkout.email, { type: "email", autoComplete: "email", inputMode: "email", required: true })}
            {field("phone", t.checkout.phone, { type: "tel", autoComplete: "tel", inputMode: "tel", required: true })}
          </div>
        </section>

        <section className={`card ${styles.block}`} aria-labelledby="checkout-delivery">
          <h2 id="checkout-delivery">{t.checkout.delivery}</h2>
          {!ships ? <p className="muted" data-testid="no-shipping">{t.checkout.noShippingDetail}</p> : null}
          {mixed ? <p className="muted" data-testid="mixed-note">{t.checkout.mixedNote}</p> : null}
          {ships ? (
          <div className={styles.choices} role="radiogroup" aria-labelledby="checkout-delivery">
            {shipping.map((m) => {
              const price = m.freeFrom !== null && subtotal >= m.freeFrom ? 0 : m.price;
              return (
                <label key={m.id} className={styles.choice} data-active={m.id === shippingId || undefined}>
                  <input type="radio" name="shipping" value={m.id} checked={m.id === shippingId} onChange={() => setShippingId(m.id)} data-testid={`shipping-${m.id}`} />
                  <span>
                    <strong>{m.label}</strong>
                    <span className="muted">{m.detail}</span>
                  </span>
                  <span className="price">{price === 0 ? t.common.free : formatPrice(price)}</span>
                </label>
              );
            })}
          </div>
          ) : null}
          {method?.requiresAddress ? (
            <>
              {field("address", t.checkout.address, { autoComplete: "street-address" })}
              <div className={styles.two}>
                {field("city", t.checkout.city, { autoComplete: "address-level2" })}
                {field("postalCode", t.checkout.postalCode, { autoComplete: "postal-code" })}
              </div>
            </>
          ) : null}
          <div className="field">
            <label htmlFor="field-notes">{t.checkout.notes}</label>
            <textarea id="field-notes" name="notes" className="input" rows={2} maxLength={500} />
          </div>
        </section>

        <section className={`card ${styles.block}`} aria-labelledby="checkout-payment">
          <h2 id="checkout-payment">{t.checkout.payment}</h2>
          {nothingToPay ? <p className="notice" data-testid="checkout-free">{t.checkout.nothingToPay}</p> : null}
          {nothingToPay ? null : (
          <div className={styles.choices} role="radiogroup" aria-labelledby="checkout-payment">
            {paymentMethods.map((m) => (
              <label key={m} className={styles.choice} data-active={m === payment || undefined}>
                <input type="radio" name="payment" value={m} checked={m === payment} onChange={() => setPayment(m)} data-testid={`payment-${m}`} />
                <span>
                  <strong>{PAYMENT_TEXT[m].label}</strong>
                  <span className="muted">{PAYMENT_TEXT[m].detail}</span>
                </span>
              </label>
            ))}
          </div>
          )}
          {payment === "online" && !nothingToPay ? <p className={`muted ${styles.hint}`}>{t.checkout.inAppHint}</p> : null}
        </section>
      </div>

      <aside className={`card ${styles.summary}`} aria-labelledby="checkout-summary">
        <h2 id="checkout-summary">{t.checkout.summary}</h2>
        <ul className={styles.items}>
          {items.map((i) => (
            <li key={i.key}>
              {i.image ? <img src={i.image.src} alt="" width={52} height={65} /> : null}
              <span>
                <strong>{i.name}</strong>
                <span className="muted">{[i.label, i.unit === "u" ? fill(t.common.units, { n: i.quantity }) : formatQuantity(i.quantity, i.unit), i.slot ? slotLabel(i.slot, languageTag) : ""].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="price">{formatPrice(lineTotal(i))}</span>
            </li>
          ))}
        </ul>
        <dl className={styles.totals}>
          <div><dt>{t.cart.subtotal}</dt><dd>{formatPrice(subtotal)}</dd></div>
          <div><dt>{t.cart.shipping}</dt><dd data-testid="checkout-shipping">{!ships ? t.checkout.noShipping : shippingPrice === 0 ? t.common.free : formatPrice(shippingPrice)}</dd></div>
          <div className={styles.total}><dt>{t.cart.estimated}</dt><dd data-testid="checkout-total">{nothingToPay ? t.common.free : formatPrice(subtotal + shippingPrice)}</dd></div>
        </dl>
        <AntibotWidget provider={antibot} onToken={setToken} resetSignal={resetSignal} />
        <div aria-live="assertive">
          {formError ? <p className="notice" role="alert" data-testid="checkout-error">{formError}</p> : null}
        </div>
        <div className={styles.confirm}>
          <button type="submit" className="btn btn-lg btn-block" aria-disabled={sending ? "true" : undefined} data-testid="confirm-order">
            {submitLabel}
          </button>
        </div>
        <p className={`muted ${styles.small}`}>{t.checkout.serverSetsTotal}</p>
        <p className={`muted ${styles.small}`}>
          {t.checkout.legalBefore}{" "}
          <Link href={paths.terms()} className="link">{t.legal.terms}</Link> {t.product.and}{" "}
          <Link href={paths.privacy()} className="link">{t.legal.privacy}</Link>.
        </p>
      </aside>
    </form>
  );
}
