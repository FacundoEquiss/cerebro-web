// /llms.txt and /llms-full.txt OF THE STORE: a plain-text card for AI assistants, generated from
// the same sources as the pages (brand, commerce rules, catalogue), so it can never say
// something the store does not.

import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { paths, tr } from "@/i18n";
import { productAvailability, selectionLabel, unitPrice, availabilityOf } from "@/lib/data/availability";
import type { Availability, Category, Product } from "@/lib/data/types";
import { formatPrice } from "@/lib/format";

const AVAILABILITY: Record<Availability, string> = { in_stock: "in stock", made_to_order: "made to order", out_of_stock: "out of stock" };

function facts(siteUrl: string): string[] {
  const lines = [`- Website: ${siteUrl}/`, `- Country: ${brand.country} · Currency: ${brand.currency}`, `- E-mail: ${brand.contact.email}`];
  if (brand.contact.phoneDisplay) lines.push(`- Phone / WhatsApp: ${brand.contact.phoneDisplay}`);
  if (brand.contact.address) lines.push(`- Address: ${brand.contact.address}`);
  if (brand.contact.hours) lines.push(`- Hours: ${tr(brand.contact.hours)}`);
  for (const m of commerce.shipping.methods.filter((s) => s.enabled)) {
    lines.push(`- ${tr(m.label)}: ${m.price === 0 ? "free" : formatPrice(m.price)}${m.freeFrom !== null && m.price > 0 ? ` (free from ${formatPrice(m.freeFrom)})` : ""}`);
  }
  lines.push(`- Preparation time: ${commerce.leadTime.minDays} to ${commerce.leadTime.maxDays} business days`);
  if (commerce.minimumOrder > 0) lines.push(`- Minimum order: ${formatPrice(commerce.minimumOrder)}`);
  return lines;
}

export function llmsTxt(products: Product[], categories: Category[], siteUrl: string): string {
  return [
    `# ${brand.name}`,
    "",
    `> ${tr(brand.description)}`,
    "",
    ...facts(siteUrl),
    "",
    "## Shop",
    "",
    `- [${tr({ es: "Todos los productos", en: "All products" })}](${siteUrl}${paths.shop()})`,
    ...categories.map((c) => `- [${c.name}](${siteUrl}${paths.category(c.slug)})${c.description ? `: ${c.description}` : ""}`),
    "",
    "## Products",
    "",
    ...products.map((p) => `- [${p.name}](${siteUrl}${paths.product(p.slug)}): ${formatPrice(p.price)} · ${AVAILABILITY[productAvailability(p)]}`),
    "",
    "## More",
    "",
    `- [Full catalogue as text](${siteUrl}/llms-full.txt)`,
    `- [Contact](${siteUrl}${paths.contact()})`,
    "",
  ].join("\n");
}

export function llmsFullTxt(products: Product[], categories: Category[], siteUrl: string): string {
  const out = [`# ${brand.name} — full catalogue`, "", `> ${tr(brand.description)}`, "", ...facts(siteUrl), ""];
  for (const c of categories) {
    const list = products.filter((p) => p.category === c.slug);
    if (list.length === 0) continue;
    out.push(`## ${c.name}`, "", c.description, "");
    for (const p of list) {
      out.push(`### ${p.name}`, "", `- URL: ${siteUrl}${paths.product(p.slug)}`, `- Price: ${formatPrice(p.price)}${p.compareAtPrice && p.compareAtPrice > p.price ? ` (list price ${formatPrice(p.compareAtPrice)})` : ""}`);
      out.push(`- Availability: ${AVAILABILITY[productAvailability(p)]}`);
      for (const o of p.options) out.push(`- ${o.name}: ${o.values.map((v) => v.label).join(", ")}`);
      if (p.variants.length > 0) {
        out.push("- Variants:");
        for (const v of p.variants) out.push(`  - ${selectionLabel(p, v.options)}: ${formatPrice(unitPrice(p, v))} · ${AVAILABILITY[availabilityOf(p, v)]}`);
      }
      out.push("", p.description, "");
    }
  }
  return out.join("\n");
}
