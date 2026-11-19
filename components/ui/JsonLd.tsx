import { jsonLdString } from "@/lib/seo";

/** Structured data, server-rendered into the HTML. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
