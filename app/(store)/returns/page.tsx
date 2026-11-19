import type { Metadata } from "next";
import { paths, t } from "@/i18n";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/content/LegalPage";

export function generateMetadata(): Metadata {
  // An unfinished template must not be indexed: remove `noindex` once the real text is in.
  return pageMetadata({ title: t.legal.returns, description: t.legal.returnsMeta, path: paths.returns(), noindex: true });
}

export default function Page() {
  return <LegalPage title={t.legal.returns} sections={t.legal.returnsSections} />;
}
