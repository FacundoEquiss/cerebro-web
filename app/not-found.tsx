import type { Metadata } from "next";
import Link from "next/link";
import { paths, t } from "@/i18n";
import { StoreShell } from "@/components/layout/StoreShell";

export const metadata: Metadata = { title: t.notFound.title, robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <StoreShell>
      <div className="container page empty-state">
        <p className="eyebrow">404</p>
        <h1>{t.notFound.title}</h1>
        <p className="muted">{t.notFound.text}</p>
        <Link href={paths.shop()} className="btn">{t.notFound.cta}</Link>
      </div>
    </StoreShell>
  );
}
