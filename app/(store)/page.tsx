import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Blocks, MessageCircle, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t, tr } from "@/i18n";
import { getCategories, getProducts } from "@/lib/data";
import { sortProducts } from "@/lib/data/query";
import { env } from "@/lib/env";
import { pageMetadata } from "@/lib/seo";
import { homeContent } from "@/lib/site";
import { ProductGrid } from "@/components/catalog/ProductCard";
import { JsonLd } from "@/components/ui/JsonLd";
import styles from "./home.module.css";

export const revalidate = 300;

export function generateMetadata(): Metadata {
  return pageMetadata({ title: `${brand.name} — ${tr(brand.tagline)}`, absoluteTitle: true, description: tr(brand.description), path: "/" });
}

/** Where the demo sends whoever wants the code, and the table that says what it is good for. */
const REPO = "https://github.com/FacundoEquiss/cerebro-web";

const ICONS = { truck: Truck, shield: ShieldCheck, message: MessageCircle, refresh: RefreshCw } as const;

export default async function HomePage() {
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const featured = sortProducts(products.filter((p) => p.featured), "featured");
  // Featured first, topped up with the rest so the grid always closes its last row (8 or 4).
  const pool = [...featured, ...sortProducts(products.filter((p) => !p.featured), "featured")];
  const shown = pool.slice(0, pool.length >= 8 ? 8 : 4);
  // The hero shows what the store sells at a glance: one product of each of three categories.
  const withPhoto = pool.filter((p) => p.images[0]);
  const distinct = withPhoto.filter((p, i) => withPhoto.findIndex((o) => o.category === p.category) === i);
  const hero = [...distinct, ...withPhoto.filter((p) => !distinct.includes(p))].slice(0, 3);
  const lead = { min: commerce.leadTime.minDays, max: commerce.leadTime.maxDays };
  const home = homeContent();
  const faq = home.faq.map((f) => ({ q: f.q, a: fill(f.a, lead) }));
  // ONLY IN DEMO MODE (DEMO_MODE=true, or a store nobody configured yet — the same switch that
  // offers the demo user on the admin login): one block saying what this is. A real store sets
  // DEMO_MODE=false (GETTING-STARTED.md) and never shows it.
  const demo = env().demoMode;

  return (
    <>
      {demo ? (
        <aside className={styles.demo} aria-label={t.demo.eyebrow} data-testid="demo-block">
          <div className={`container ${styles.demoInner}`}>
            <span className={styles.demoIcon} aria-hidden><Blocks /></span>
            <div>
              <p className="eyebrow">{t.demo.eyebrow}</p>
              <p className={styles.demoTitle}>{t.demo.title}</p>
              <p className={styles.demoText}>{t.demo.text}</p>
            </div>
            <div className={styles.demoActions}>
              <a href={REPO} className="btn" target="_blank" rel="noopener noreferrer" data-testid="demo-repo">{t.demo.repo}</a>
              <a href={`${REPO}${brand.locale === "es" ? "/blob/main/README.es.md#para-qué-rubros-sirve" : "#which-businesses-it-fits"}`} className="btn btn-secondary" target="_blank" rel="noopener noreferrer" data-testid="demo-table">{t.demo.table}</a>
            </div>
          </div>
        </aside>
      ) : null}
      <section className={styles.hero}>
        <div className={`container ${styles.heroGrid}`}>
          <div className={`${styles.heroText} rise`}>
            <p className="eyebrow">{home.heroEyebrow}</p>
            <h1>{home.heroTitle}</h1>
            <p className={styles.heroLead}>{home.heroText}</p>
            <div className={styles.heroActions}>
              <Link href={paths.shop()} className="btn btn-lg" data-testid="hero-cta">
                {home.heroCta} <ArrowRight aria-hidden size={18} />
              </Link>
              <a href="#faq" className="btn btn-lg btn-secondary">{t.home.heroSecondary}</a>
            </div>
          </div>
          <div className={styles.heroMedia} aria-hidden>
            {hero.map((p, i) =>
              p.images[0] ? (
                <img key={p.id} src={p.images[0].src} alt="" width={p.images[0].width} height={p.images[0].height} fetchPriority={i === 0 ? "high" : "auto"} className={styles[`heroImg${i}`]} />
              ) : null,
            )}
          </div>
        </div>
      </section>

      <section className="section container" aria-labelledby="home-categories">
        <div className="section-head">
          <h2 id="home-categories">{t.home.categoriesTitle}</h2>
          <Link href={paths.shop()} className="link">{t.common.seeAll}</Link>
        </div>
        <ul className={styles.categories} data-four={categories.length % 4 === 0 ? "" : undefined}>
          {categories.map((c) => {
            const sample = products.find((p) => p.category === c.slug)?.images[0];
            const count = products.filter((p) => p.category === c.slug).length;
            return (
              <li key={c.slug}>
                <Link href={paths.category(c.slug)} className={styles.category}>
                  {sample ? <img src={sample.src} alt="" width={sample.width} height={sample.height} loading="lazy" decoding="async" /> : null}
                  <span className={styles.categoryLabel}>
                    <strong>{c.name}</strong>
                    <span>{count === 1 ? t.shop.resultOne : fill(t.shop.results, { n: count })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section container" aria-labelledby="home-featured">
        <div className="section-head">
          <h2 id="home-featured">{t.home.featuredTitle}</h2>
          <Link href={paths.shop()} className="link">{t.common.seeAll}</Link>
        </div>
        <ProductGrid products={shown} />
      </section>

      <section className={styles.benefitsBand} aria-labelledby="home-benefits">
        <div className="container">
          <h2 id="home-benefits" className="sr-only">{t.home.benefitsTitle}</h2>
          <ul className={styles.benefits}>
            {home.benefits.map((b) => {
              const Icon = ICONS[b.icon as keyof typeof ICONS] ?? ShieldCheck;
              return (
                <li key={b.title}>
                  <span className={styles.benefitIcon}><Icon aria-hidden /></span>
                  <div>
                    <h3>{b.title}</h3>
                    <p className="muted">{b.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section container" id="faq" aria-labelledby="home-faq">
        <div className={styles.faqGrid}>
          <div>
            <h2 id="home-faq">{t.home.faqTitle}</h2>
            <p className={`muted ${styles.faqLead}`}>{t.home.ctaText}</p>
            <Link href={paths.contact()} className="btn btn-secondary">{t.home.ctaButton}</Link>
          </div>
          <div className={styles.faq}>
            {faq.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        }}
      />
    </>
  );
}
