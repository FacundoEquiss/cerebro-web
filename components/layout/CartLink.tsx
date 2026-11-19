"use client";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { fill, paths, t } from "@/i18n";
import { cartCount, useCart } from "@/stores/cart";

export function CartLink({ className, badgeClassName, label }: { className?: string; badgeClassName?: string; label?: boolean }) {
  const count = useCart((s) => cartCount(s.lines));
  return (
    <Link
      href={paths.cart()}
      className={className}
      aria-label={count > 0 ? fill(t.nav.cartWithCount, { n: count }) : t.nav.cart}
      data-testid="cart-link"
    >
      <ShoppingBag aria-hidden />
      {label ? <span>{t.nav.cart}</span> : null}
      {count > 0 ? (
        <span className={badgeClassName} data-testid="cart-count" aria-hidden>
          {count}
        </span>
      ) : null}
    </Link>
  );
}
