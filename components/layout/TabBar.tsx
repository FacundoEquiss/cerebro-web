"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Store } from "lucide-react";
import { paths, t } from "@/i18n";
import { CartLink } from "./CartLink";
import styles from "./TabBar.module.css";

/** Phone only: the four most frequent actions, within reach of the thumb. */
export function TabBar() {
  const pathname = usePathname();
  // The checkout has its own fixed "confirm" bar: two stacked bars would bury the pay button.
  if (pathname === paths.checkout() || pathname === "/checkout") return null;
  const items = [
    { href: "/", label: t.common.home, Icon: Home, active: pathname === "/" },
    { href: paths.shop(), label: t.nav.shop, Icon: Store, active: pathname.startsWith(paths.shop()) },
    { href: paths.search(), label: t.nav.search, Icon: Search, active: pathname.startsWith(paths.search()) },
  ];
  return (
    <nav className={styles.bar} aria-label={t.nav.mobile}>
      {items.map(({ href, label, Icon, active }) => (
        <Link key={href} href={href} className={styles.item} aria-current={active ? "page" : undefined}>
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
      <CartLink className={styles.item} badgeClassName={styles.count} label />
    </nav>
  );
}
