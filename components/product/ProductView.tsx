"use client";
// The top of the product page: gallery + buy box. They live together because choosing a colour
// changes the photo. Server-rendered like everything else: name, price and options are in the
// HTML before any JavaScript runs.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t } from "@/i18n";
import { track } from "@/lib/analytics/client";
import { availabilityOf, findVariant, missingOptions, productAvailability, unitPrice, unitsAvailable } from "@/lib/data/availability";
import type { Product } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";
import { useCart } from "@/stores/cart";
import styles from "./ProductView.module.css";

export function ProductView({ product }: { product: Product }) {
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
  const max = Math.min(commerce.maxQuantityPerLine, complete && !unavailable ? unitsAvailable(product, variant) : commerce.maxQuantityPerLine);
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
    add({ productId: product.id, variantId: variant?.id ?? null, selection, quantity }, product.options.map((o) => o.id), max);
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
          <span className={`price ${onSale ? "price-sale" : ""}`}>{formatPrice(price)}</span>
          {onSale ? (
            <>
              <span className="sr-only">{t.product.listPrice}: </span>
              <span className="price-compare">{formatPrice(product.compareAtPrice!)}</span>
            </>
          ) : null}
        </p>
        {commerce.installments.enabled ? (
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

        <p className={styles.stock} data-state={availability} data-testid="stock-status">
          <span className={styles.dot} aria-hidden />
          {availability === "out_of_stock" ? (complete ? t.product.soldOutDetail : t.product.soldOut)
            : availability === "made_to_order" ? fill(t.product.madeToOrderDetail, lead)
            : units !== null && units <= 5 ? `${fill(t.product.lowStock, { n: units })} · ${fill(t.product.inStockDetail, lead)}`
            : fill(t.product.inStockDetail, lead)}
        </p>

        <div className={styles.actions}>
          <div className={styles.quantity}>
            <button type="button" onClick={() => setQuantity((q) => Math.max(product.minQuantity, q - 1))} aria-label={t.product.decrease} disabled={quantity <= product.minQuantity}>
              <Minus aria-hidden size={16} />
            </button>
            <output aria-label={t.product.quantity} data-testid="quantity">{quantity}</output>
            <button type="button" onClick={() => setQuantity((q) => Math.min(max, q + 1))} aria-label={t.product.increase} disabled={quantity >= max}>
              <Plus aria-hidden size={16} />
            </button>
          </div>
          <button
            type="button"
            className={`btn btn-lg ${styles.add}`}
            onClick={addToCart}
            aria-disabled={availability === "out_of_stock" && complete ? "true" : undefined}
            data-testid="add-to-cart"
          >
            {availability === "out_of_stock" && complete ? t.product.unavailable : t.product.addToCart}
          </button>
        </div>

        <div aria-live="polite" className={styles.feedback}>
          {error ? <p className="field-error" data-testid="option-error">{error}</p> : null}
          {added ? (
            <p className={styles.added} data-testid="added-notice">
              <Check aria-hidden size={18} /> {t.product.added}
              <Link href={paths.cart()} className="link" data-testid="view-cart">{t.product.viewCart}</Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
