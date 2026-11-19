"use client";
// Third-party measurement, loaded ONLY when: this is the production store, an ID is configured,
// and the visitor accepted. Scripts are injected after the page is interactive, so they never
// compete with the content. Also: restores the cart and records where the visit came from.

import { useEffect, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { paths, t } from "@/i18n";
import { captureAttribution } from "@/lib/analytics/attribution";
import { CONSENT_EVENT, readConsent, writeConsent, type Consent } from "@/lib/analytics/consent";
import { analyticsConfigured, publicEnv } from "@/lib/public-env";
import { hydrateCart } from "@/stores/cart";
import styles from "./Analytics.module.css";

export function Analytics() {
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void hydrateCart();
    captureAttribution();
    const sync = () => setConsent(readConsent());
    const reopen = () => setOpen(true);
    sync();
    setReady(true);
    window.addEventListener(CONSENT_EVENT, sync);
    window.addEventListener("consent-open", reopen);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener("consent-open", reopen);
    };
  }, []);

  if (!analyticsConfigured || !ready) return null;
  const granted = consent === "granted";
  const choose = (value: "granted" | "denied") => {
    writeConsent(value);
    setOpen(false);
  };

  return (
    <>
      {granted && publicEnv.ga4Id ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${publicEnv.ga4Id}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(publicEnv.ga4Id)});`}
          </Script>
        </>
      ) : null}
      {granted && publicEnv.metaPixelId ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(publicEnv.metaPixelId)});fbq('track','PageView');`}
        </Script>
      ) : null}
      {granted && publicEnv.clarityId ? (
        <Script id="clarity" strategy="lazyOnload">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(publicEnv.clarityId)});`}
        </Script>
      ) : null}
      {consent === null || open ? (
        <section className={styles.banner} role="dialog" aria-label={t.consent.title} data-testid="consent-banner">
          <div>
            <p className={styles.title}>{t.consent.title}</p>
            <p className={styles.text}>
              {t.consent.text}{" "}
              <Link href={paths.privacy()} className="link">{t.consent.more}</Link>
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-secondary" onClick={() => choose("denied")}>{t.consent.reject}</button>
            <button type="button" className="btn" onClick={() => choose("granted")}>{t.consent.accept}</button>
          </div>
        </section>
      ) : null}
    </>
  );
}
