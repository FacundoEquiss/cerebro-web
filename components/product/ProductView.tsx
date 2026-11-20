"use client";
// The top of the product page: gallery + buy box. They live together because choosing a colour
// changes the photo. Server-rendered like everything else: name, price and options are in the
// HTML before any JavaScript runs.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t } from "@/i18n";
import { track } from "@/lib/analytics/client";
import { availabilityOf, byPiece, findVariant, maxQuantityOf, missingOptions, productAvailability, roundQuantity, unitPrice, unitsAvailable } from "@/lib/data/availability";
import type { Product } from "@/lib/data/types";
import { formatPrice, formatQuantity, formatUnitPrice, lineTotal } from "@/lib/format";
import { useCart } from "@/stores/cart";
import { QuoteForm } from "./QuoteForm";
import { SlotPicker } from "./SlotPicker";
import styles from "./ProductView.module.css";

export interface BookingInfo {
  timeZone: string;
  durationMinutes: number;
}

export function ProductView({ product, booking, antibot = "none" }: { product: Product; booking?: BookingInfo; antibot?: string }) {
  const isQuote = product.type === "quote";
  const isService = product.type === "service";
  const [slot, setSlot] = useState("");
  // Bookings, quotes and downloads need a store that remembers orders (lib/store-mode.ts). The
  // answer is asked when the page opens: "contact" = this store cannot take them online.
  const needsStore = product.type !== "physical";
  const [mode, setMode] = useState<"live" | "demo" | "contact" | null>(needsStore ? null : "live");
  useEffect(() => {
    if (!needsStore) return;
    let alive = true;
    fetch("/api/store-mode", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { mode: "live" | "demo" | "contact" }) => alive && setMode(body.mode))
      .catch(() => alive && setMode("live"));
    return () => {
      alive = false;
    };
  }, [needsStore]);
  const kind = isQuote ? "quote" : isService ? "service" : "digital";
  const whatsapp = brand.contact.whatsapp
    ? `https://wa.me/${brand.contact.whatsapp}?text=${encodeURIComponent(fill(t.types.contactMessage, { product: product.name }))}`
    : null;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(product.minQuantity);
  const [imageIndex, setImageIndex] = useState(0);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const add = useCart((s) => s.add);
  const optionsRef = useRef<HTMLDivElement>(null);

  const missing = missingOptions(product, selection);
  const complete = missing.length === 0;
  const variant = complete ? findVariant(product, selection) : undefined;
  // Options declared and variants generated, but this combination does not exist.
  const unavailable = complete && product.options.length > 0 && product.variants.length > 0 && !variant;
  const availability = unavailable ? "out_of_stock" : complete ? availabilityOf(product, variant) : productAvailability(product);
  const price = unitPrice(product, variant);
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > price;
  // A download is one per order line.
  const limit = product.type === "digital" ? 1 : maxQuantityOf(product, commerce.maxQuantityPerLine);
  const max = Math.min(limit, complete && !unavailable ? unitsAvailable(product, variant) : limit);
  const step = product.step > 0 ? product.step : 1;
  const piece = byPiece(product);
  const lead = { min: commerce.leadTime.minDays, max: commerce.leadTime.maxDays };
  const units = complete && variant?.stock != null ? variant.stock : product.options.length === 0 ? product.stock : null;

  /** Is a value still purchasable with what is already chosen in the OTHER options? */
  const valueState = useMemo(() => {
    return (optionId: string, valueId: string): boolean => {
      if (product.variants.length === 0) return true;
      const wanted = { ...selection, [optionId]: valueId };
      return product.variants.some(
        (v) => (v.stock === null || v.stock > 0) && Object.entries(wanted).every(([k, val]) => v.options[k] === val),
      );
    };
  }, [product, selection]);

  function choose(optionId: string, valueId: string) {
    const next = { ...selection, [optionId]: valueId };
    setSelection(next);
    setError("");
    setAdded(false);
    // Show the photo of that value, if the product has one.
    const i = product.images.findIndex((img) => img.option?.[optionId] === valueId);
    if (i >= 0) setImageIndex(i);
  }

  function addToCart() {
    if (!complete) {
      const names = product.options.filter((o) => missing.includes(o.id)).map((o) => o.name.toLowerCase());
      setError(fill(t.product.chooseFirst, { options: names.join(` ${t.product.and} `) }));
      optionsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (availability === "out_of_stock") return;
    if (isService && !slot) {
      setError(t.types.chooseSlotFirst);
      return;
    }
    add({ productId: product.id, variantId: variant?.id ?? null, selection, quantity, ...(isService ? { slot } : {}) }, product.options.map((o) => o.id), max);
    track("add_to_cart", [{ productId: product.id, variantId: variant?.id, name: product.name, price, quantity }], brand.currency);
    setAdded(true);
  }

  const image = product.images[imageIndex] ?? product.images[0];

  return (
    <div className={styles.layout}>
      <div className={styles.gallery} role="group" aria-label={t.product.gallery}>
        <div className={styles.main}>
          {image ? (
            <img src={image.src} alt={image.alt} width={image.width} height={image.height} fetchPriority="high" data-testid="product-image" />
          ) : null}
        </div>
        {product.images.length > 1 ? (
          <ul className={styles.thumbs}>
            {product.images.map((img, i) => (
              <li key={img.src}>
                <button type="button" onClick={() => setImageIndex(i)} aria-label={fill(t.product.showImage, { n: i + 1 })} aria-current={i === imageIndex ? "true" : undefined}>
                  <img src={img.src} alt="" width={img.width} height={img.height} loading="lazy" decoding="async" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className={styles.buy}>
        <h1 className={styles.name} data-testid="product-name">{product.name}</h1>
        <p className={styles.price} data-testid="product-price">
          {isQuote ? <span className="price">{t.types.consult}</span> : <span className={`price ${onSale ? "price-sale" : ""}`}>{formatUnitPrice(price, product.unit)}</span>}
          {onSale && !isQuote ? (
            <>
              <span className="sr-only">{t.product.listPrice}: </span>
              <span className="price-compare">{formatPrice(product.compareAtPrice!)}</span>
            </>
          ) : null}
        </p>
        {product.type !== "physical" || !piece ? (
          <p className={styles.kind} data-testid="product-kind">
            {product.type !== "physical" ? <span className="badge badge-soft">{t.types.badge[product.type]}</span> : null}
            <span>
              {isQuote ? t.types.quoteDetail
                : isService ? fill(t.types.serviceDetail, { minutes: booking?.durationMinutes ?? product.service?.durationMinutes ?? 60 })
                : product.type === "digital" ? t.types.digitalDetail
                : fill(t.types.unitDetail, { unit: product.unit, min: formatQuantity(product.minQuantity, product.unit), step: formatQuantity(step, product.unit) })}
            </span>
          </p>
        ) : null}
        {commerce.installments.enabled && !isQuote ? (
          <p className="muted">
            {commerce.installments.interestFree
              ? fill(t.product.installments, { n: commerce.installments.count, price: formatPrice(price / commerce.installments.count) })
              : fill(t.product.installmentsInterest, { n: commerce.installments.count })}
          </p>
        ) : null}

        <div ref={optionsRef} className={styles.options}>
          {product.options.map((option) => {
            const chosen = option.values.find((v) => v.id === selection[option.id]);
            return (
              <fieldset key={option.id} className={styles.option} data-testid={`option-${option.id}`}>
                <legend>
                  {option.name}
                  {chosen ? <span className={styles.chosen}>: {chosen.label}</span> : null}
                </legend>
                <div className={styles.values}>
                  {option.values.map((value) => {
                    const ok = valueState(option.id, value.id);
                    const active = selection[option.id] === value.id;
                    return (
                      <label key={value.id} className={styles.value} data-active={active || undefined} data-off={!ok || undefined} data-swatch={value.swatch ? "" : undefined}>
                        <input
                          type="radio"
                          name={`option-${option.id}`}
                          value={value.id}
                          checked={active}
                          onChange={() => choose(option.id, value.id)}
                          className="sr-only"
                        />
                        {value.swatch ? <span className={styles.swatch} style={{ background: value.swatch }} aria-hidden /> : null}
                        <span>{value.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        {mode === null ? <div className="skeleton" style={{ height: 120 }} role="status" aria-label={t.common.loading} /> : null}

        {mode === "contact" ? (
          // A real store that cannot remember orders: no booking, no quote form, no cart for this.
          <div className={`card ${styles.contact}`} data-testid="contact-instead">
            <p>{t.types.contact[kind]}</p>
            <div className={styles.contactActions}>
              {whatsapp ? <a href={whatsapp} className="btn" target="_blank" rel="noopener noreferrer" data-testid="contact-whatsapp">{t.types.contactWhatsapp}</a> : null}
              <Link href={paths.contact()} className={`btn ${whatsapp ? "btn-secondary" : ""}`} data-testid="contact-link">{t.types.contactPage}</Link>
            </div>
          </div>
        ) : null}

        {mode === "demo" ? <p className="notice" data-testid="demo-not-stored">{t.types.demo[kind]}</p> : null}

        {isService && booking && (mode === "live" || mode === "demo") ? (
          <SlotPicker productId={product.id} timeZone={booking.timeZone} seats={quantity} value={slot} onChange={(v) => { setSlot(v); setError(""); setAdded(false); }} />
        ) : null}

        {isQuote && (mode === "live" || mode === "demo") ? <QuoteForm product={product} antibot={antibot} /> : null}

        {isQuote || isService || product.type === "digital" ? null : (
        <p className={styles.stock} data-state={availability} data-testid="stock-status">
          <span className={styles.dot} aria-hidden />
          {availability === "out_of_stock" ? (complete ? t.product.soldOutDetail : t.product.soldOut)
            : availability === "made_to_order" ? fill(t.product.madeToOrderDetail, lead)
            : units !== null && units <= 5 ? `${fill(t.product.lowStock, { n: units })} · ${fill(t.product.inStockDetail, lead)}`
            : fill(t.product.inStockDetail, lead)}
        </p>
        )}

        {isQuote || mode === null || mode === "contact" ? null : (
        <div className={styles.actions}>
          {product.type === "digital" ? null : (
          <div className={styles.quantity} title={isService ? t.types.seats : undefined}>
            <button type="button" onClick={() => setQuantity((q) => roundQuantity(Math.max(product.minQuantity, q - step)))} aria-label={t.product.decrease} disabled={quantity <= product.minQuantity}>
              <Minus aria-hidden size={16} />
            </button>
            <output aria-label={isService ? t.types.seats : t.product.quantity} data-testid="quantity">{formatQuantity(quantity, product.unit)}</output>
            <button type="button" onClick={() => setQuantity((q) => roundQuantity(Math.min(max, q + step)))} aria-label={t.product.increase} disabled={quantity + step > max + 1e-9}>
              <Plus aria-hidden size={16} />
            </button>
          </div>
          )}
          <button
            type="button"
            className={`btn btn-lg ${styles.add}`}
            onClick={addToCart}
            aria-disabled={availability === "out_of_stock" && complete ? "true" : undefined}
            data-testid="add-to-cart"
          >
            {availability === "out_of_stock" && complete ? t.product.unavailable : isService ? t.types.book : t.product.addToCart}
            {!piece && !(availability === "out_of_stock" && complete) ? <span className={styles.lineTotal}> · {formatPrice(lineTotal({ unitPrice: price, quantity }))}</span> : null}
          </button>
        </div>
        )}
        {!piece && !isQuote ? <p className={`muted ${styles.note}`}>{t.types.weightNote}</p> : null}

        <div aria-live="polite" className={styles.feedback}>
          {error ? <p className="field-error" data-testid="option-error">{error}</p> : null}
          {added ? (
            <p className={styles.added} data-testid="added-notice">
              <Check aria-hidden size={18} /> {isService ? t.types.booked : t.product.added}
              <Link href={paths.cart()} className="link" data-testid="view-cart">{t.product.viewCart}</Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
