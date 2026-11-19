import Link from "next/link";
import { brand } from "@/config/brand";
import { fill, paths, t, tr } from "@/i18n";
import type { Category } from "@/lib/data/types";
import { ConsentLink } from "@/components/analytics/ConsentLink";
import styles from "./Footer.module.css";

export function Footer({ categories }: { categories: Category[] }) {
  const social = Object.entries(brand.social).filter((e): e is [string, string] => Boolean(e[1]));
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div>
          <p className={styles.brand}>{brand.name}</p>
          <p className="muted">{tr(brand.tagline)}</p>
        </div>
        <nav aria-label={t.footer.shop}>
          <h2 className={styles.title}>{t.footer.shop}</h2>
          <ul>
            <li><Link href={paths.shop()}>{t.shop.allProducts}</Link></li>
            {categories.map((c) => (
              <li key={c.slug}><Link href={paths.category(c.slug)}>{c.name}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.help}>
          <h2 className={styles.title}>{t.footer.help}</h2>
          <ul>
            <li><Link href={paths.contact()}>{t.nav.contact}</Link></li>
            <li><Link href={paths.returns()}>{t.legal.returns}</Link></li>
            <li><Link href={paths.terms()}>{t.legal.terms}</Link></li>
            <li><Link href={paths.privacy()}>{t.legal.privacy}</Link></li>
            <li><ConsentLink /></li>
          </ul>
        </nav>
        <div>
          <h2 className={styles.title}>{t.footer.contactTitle}</h2>
          <ul>
            <li><a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a></li>
            {brand.contact.phoneDisplay ? <li>{brand.contact.phoneDisplay}</li> : null}
            {brand.contact.hours ? <li>{tr(brand.contact.hours)}</li> : null}
            {social.map(([name, url]) => (
              <li key={name}>
                <a href={url} rel="noopener noreferrer" target="_blank" style={{ textTransform: "capitalize" }}>{name}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className={`container ${styles.bottom}`}>
        <p>{fill(t.footer.rights, { year: new Date().getFullYear(), brand: brand.name })}</p>
        <p>{t.footer.builtWith}</p>
      </div>
    </footer>
  );
}
