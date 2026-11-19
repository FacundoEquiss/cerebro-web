import type { Metadata } from "next";
import { paths, t } from "@/i18n";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/content/LegalPage";

export function generateMetadata(): Metadata {
  // An unfinished template must not be indexed: remove `noindex` once the real text is in.
  return pageMetadata({ title: t.legal.privacy, description: t.legal.privacyMeta, path: paths.privacy(), noindex: true });
}

export default function Page() {
  return <LegalPage title={t.legal.privacy} sections={t.legal.privacySections} />;
}
