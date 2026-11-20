import Link from "next/link";
import { Search } from "lucide-react";
import { brand } from "@/config/brand";
import { paths, t } from "@/i18n";
import type { Category } from "@/lib/data/types";
import { CartLink } from "./CartLink";
import styles from "./Header.module.css";

export function Header({ categories }: { categories: Category[] }) {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <Link href="/" className={styles.brand} data-testid="brand">
          {brand.name}
        </Link>
        <nav aria-label={t.nav.main} className={styles.nav}>
          <ul>
            <li>
              <Link href={paths.shop()}>{t.nav.shop}</Link>
            </li>
            {/* A store with many categories shows the first ones here; all of them are in the shop. */}
            {categories.slice(0, 6).map((c) => (
              <li key={c.slug} data-category>
                <Link href={paths.category(c.slug)}>{c.name}</Link>
              </li>
            ))}
            <li>
              <Link href={paths.contact()}>{t.nav.contact}</Link>
            </li>
          </ul>
        </nav>
        <div className={styles.actions}>
          <Link href={paths.search()} className={styles.icon} aria-label={t.nav.search}>
            <Search aria-hidden />
          </Link>
          <CartLink className={styles.icon} badgeClassName={styles.count} />
        </div>
      </div>
    </header>
  );
}
