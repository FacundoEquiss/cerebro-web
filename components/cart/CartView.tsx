"use client";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { commerce } from "@/config/commerce";
import { fill, languageTag, paths, t } from "@/i18n";
import { resolveLine, slotLabel, type CartProduct } from "@/lib/cart-catalog";
import { needsShipping } from "@/lib/data/availability";
import { formatPrice, formatQuantity, formatUnitPrice, lineTotal } from "@/lib/format";
import { useCart } from "@/stores/cart";
import styles from "./CartView.module.css";

export function CartView({ catalog }: { catalog: CartProduct[] }) {
  const { lines, hydrated, setQuantity, remove } = useCart();

  if (!hydrated) return <div className="skeleton" style={{ height: 220 }} role="status" aria-label={t.common.loading} />;
  if (lines.length === 0) {
    return (
      <div className="empty-state" data-testid="cart-empty">
        <p className="muted">{t.cart.empty}</p>
        <Link href={paths.shop()} className="btn">{t.cart.emptyCta}</Link>
      </div>
    );
  }

  const resolved = lines.map((line) => ({ line, item: resolveLine(line, catalog) }));
  const valid = resolved.flatMap((r) => (r.item ? [r.item] : []));
  const subtotal = valid.reduce((sum, i) => sum + lineTotal(i), 0);
  const ships = needsShipping(valid);
  // The minimum order is about money: a cart of free products only is not held to it.
  const belowMinimum = commerce.minimumOrder > 0 && subtotal < commerce.minimumOrder && valid.some((i) => i.unitPrice > 0);
  const canCheckout = valid.length > 0 && !belowMinimum;

  return (
    <div className={styles.layout}>
      <ul className={styles.lines} data-testid="cart-lines">
        {resolved.map(({ line, item }) =>
          item ? (
            <li key={line.key} className={styles.line} data-testid="cart-line">
              <Link href={paths.product(item.slug)} className={styles.thumb} tabIndex={-1} aria-hidden>
                {item.image ? <img src={item.image.src} alt="" width={96} height={120} loading="lazy" /> : null}
              </Link>
              <div className={styles.info}>
                <Link href={paths.product(item.slug)} className={styles.name}>{item.name}</Link>
                {item.label ? <p className="muted" data-testid="cart-line-variant">{item.label}</p> : null}
                {item.slot ? <p className="muted" data-testid="cart-line-slot">{t.types.appointment}: {slotLabel(item.slot, languageTag)}</p> : null}
                <p className="muted">{fill(t.cart.unitPrice, { price: formatUnitPrice(item.unitPrice, item.unit) })}</p>
                <div className={styles.row}>
                  <div className={styles.quantity}>
                    <button type="button" aria-label={t.product.decrease} onClick={() => setQuantity(line.key, Math.max(item.min, item.quantity - item.step))} disabled={item.quantity <= item.min || item.type === "digital"}>
                      <Minus aria-hidden size={15} />
                    </button>
                    <output aria-label={t.product.quantity} data-testid="cart-line-quantity">{formatQuantity(item.quantity, item.unit)}</output>
                    <button type="button" aria-label={t.product.increase} onClick={() => setQuantity(line.key, Math.min(item.max, item.quantity + item.step))} disabled={item.quantity + item.step > item.max + 1e-9 || item.type === "digital" || item.type === "service"}>
                      <Plus aria-hidden size={15} />
                    </button>
                  </div>
                  <button type="button" className={styles.remove} onClick={() => remove(line.key)} aria-label={fill(t.cart.remove, { name: item.name })}>
                    <Trash2 aria-hidden size={18} />
                  </button>
                </div>
              </div>
              <p className={`price ${styles.lineTotal}`}>{formatPrice(lineTotal(item))}</p>
            </li>
          ) : (
            <li key={line.key} className={`${styles.line} ${styles.gone}`}>
              <div className={styles.info}>
                <p className="field-error">{t.cart.lineUnavailable}</p>
                <button type="button" className="link" onClick={() => remove(line.key)}>{t.cart.removeGone}</button>
              </div>
            </li>
          ),
        )}
      </ul>

      <aside className={`card ${styles.summary}`} aria-label={t.checkout.summary}>
        <dl>
          <div><dt>{t.cart.subtotal}</dt><dd className="price" data-testid="cart-subtotal">{formatPrice(subtotal)}</dd></div>
          <div><dt>{t.cart.shipping}</dt><dd className="muted" data-testid="cart-shipping">{ships ? t.cart.shippingAtCheckout : t.types.noShipping}</dd></div>
        </dl>
        {belowMinimum ? <p className="notice">{fill(t.cart.minimum, { price: formatPrice(commerce.minimumOrder) })}</p> : null}
        <Link
          href={canCheckout ? paths.checkout() : "#"}
          className="btn btn-lg btn-block"
          aria-disabled={canCheckout ? undefined : "true"}
          data-testid="go-to-checkout"
        >
          {t.cart.checkout}
        </Link>
        <Link href={paths.shop()} className="btn btn-ghost btn-block">{t.cart.keepShopping}</Link>
        <p className={`muted ${styles.note}`}>{t.cart.estimatedNote}</p>
      </aside>
    </div>
  );
}
