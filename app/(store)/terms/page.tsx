import type { Metadata } from "next";
import { paths, t } from "@/i18n";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/content/LegalPage";

export function generateMetadata(): Metadata {
  // An unfinished template must not be indexed: remove `noindex` once the real text is in.
  return pageMetadata({ title: t.legal.terms, description: t.legal.termsMeta, path: paths.terms(), noindex: true });
}

export default function Page() {
  return <LegalPage title={t.legal.terms} sections={t.legal.termsSections} />;
}
