// The texts of the home page (hero, benefits, frequently asked questions). They come from
// content/site.json — written by `npm run preset <name>` and edited freely afterwards — and fall
// back to the dictionaries of i18n/ when that file has no `home`.

import site from "@/content/site.json";
import { t, tr } from "@/i18n";

type Text = string | Record<string, string>;
interface HomeContent {
  heroEyebrow?: Text;
  heroTitle?: Text;
  heroText?: Text;
  heroCta?: Text;
  benefits?: { icon: string; title: Text; text: Text }[];
  faq?: { q: Text; a: Text }[];
}

/** The preset this store started from ("mixto" = the demo). */
export const sitePreset: string = (site as { preset?: string }).preset ?? "";

export function homeContent() {
  const home = ((site as { home?: HomeContent | null }).home ?? {}) as HomeContent;
  return {
    heroEyebrow: tr(home.heroEyebrow) || t.home.heroEyebrow,
    heroTitle: tr(home.heroTitle) || t.home.heroTitle,
    heroText: tr(home.heroText) || t.home.heroText,
    heroCta: tr(home.heroCta) || t.home.heroCta,
    benefits: home.benefits?.length ? home.benefits.map((b) => ({ icon: b.icon, title: tr(b.title), text: tr(b.text) })) : t.benefits,
    faq: home.faq?.length ? home.faq.map((f) => ({ q: tr(f.q), a: tr(f.a) })) : t.faq,
  };
}
