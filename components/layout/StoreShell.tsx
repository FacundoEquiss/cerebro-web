import type { ReactNode } from "react";
import { t } from "@/i18n";
import { getCategories } from "@/lib/data";
import { env } from "@/lib/env";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import { Analytics } from "@/components/analytics/Analytics";
import { JsonLd } from "@/components/ui/JsonLd";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { TabBar } from "./TabBar";

/** The chrome of every storefront page: header, footer, phone tab bar, measurement. */
export async function StoreShell({ children }: { children: ReactNode }) {
  const categories = await getCategories();
  return (
    <div className="store">
      <a href="#content" className="skip-link">{t.common.skipToContent}</a>
      {env().isDemo ? (
        <p className="demo-banner" data-testid="demo-banner">{t.common.demoBanner}</p>
      ) : null}
      <Header categories={categories} />
      <main id="content">{children}</main>
      <Footer categories={categories} />
      <TabBar />
      <Analytics />
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
    </div>
  );
}
