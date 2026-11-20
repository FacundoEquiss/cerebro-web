// Metadata and structured data, all fed from the single sources (config/brand.ts,
// config/commerce.ts, the catalogue). What the markup says must equal what the page shows and
// what the feeds say — that is why everything is derived here and nothing is typed by hand.

import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { languageTag, paths, tr } from "@/i18n";
import { isEvent, seatsOverlapping, serviceRules, upcomingSessions, type Held } from "@/lib/booking/slots";
import { availabilityOf, byPiece, productAvailability, unitPrice } from "@/lib/data/availability";
import type { Availability, Category, Product } from "@/lib/data/types";
import { env } from "@/lib/env";
import { plainPrice } from "@/lib/format";
import { absoluteUrl } from "@/lib/url";

export const siteUrl = () => env().siteUrl;
export const absolute = (path: string) => absoluteUrl(path, siteUrl());

interface PageMeta {
  /** Without the brand: the layout template appends it. */
  title: string;
  description: string;
  /** Public path of the page (the canonical one, never with filter parameters). */
  path: string;
  noindex?: boolean;
  image?: string;
  /** Set when `title` already names the brand. */
  absoluteTitle?: boolean;
}

export function pageMetadata({ title, description, path, noindex, image, absoluteTitle }: PageMeta): Metadata {
  const url = absolute(path);
  const index = env().allowIndexing && !noindex;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      url,
      siteName: brand.name,
      title: absoluteTitle ? title : `${title} | ${brand.name}`,
      description,
      locale: languageTag.replace("-", "_"),
      ...(image ? { images: [{ url: absolute(image) }] } : {}),
    },
    twitter: { card: "summary_large_image" },
  };
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  made_to_order: "https://schema.org/BackOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

/** The business. Only the fields that are really known are emitted. */
export function organizationJsonLd() {
  const sameAs = Object.values(brand.social).filter((v): v is NonNullable<typeof v> => Boolean(v));
  return {
    "@context": "https://schema.org",
    "@type": brand.contact.address ? "Store" : "OnlineStore",
    "@id": `${siteUrl()}/#organization`,
    name: brand.name,
    description: tr(brand.description),
    url: siteUrl(),
    logo: absolute("/icon.svg"),
    email: brand.contact.email,
    ...(brand.contact.phoneDisplay ? { telephone: brand.contact.phoneDisplay } : {}),
    ...(brand.contact.address
      ? { address: { "@type": "PostalAddress", streetAddress: brand.contact.address, addressCountry: brand.country } }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl()}/#website`,
    name: brand.name,
    url: siteUrl(),
    inLanguage: languageTag,
    publisher: { "@id": `${siteUrl()}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absolute(paths.search())}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: absolute(item.path) })),
  };
}

/**
 * STRUCTURED DATA PER PRODUCT TYPE
 *   physical  `Product` + `Offer` (per variant). Sold by weight or measure: the offer also carries a
 *             `UnitPriceSpecification` saying which quantity the price refers to.
 *   digital   `Product` + `Offer`, always in stock (a file does not run out).
 *   service   `Service` (not `Product`) with its provider and an `Offer` with the price of one slot.
 *   event     (a service with its own dates) one `Event` per upcoming date, with its start and
 *             end. Its offer says `SoldOut` when the seats already held (`held`) fill that date.
 *   quote     `Product` WITHOUT `offers`: there is no public price, so none is declared. Never a
 *             made-up amount, never "0".
 *
 * Product + offers. One offer per variant when there are variants, so the price and availability
 * of each one match the page and the feeds. Shipping details and return policy are NOT emitted:
 * a half-filled block is worse than none — add them when the real conditions are confirmed.
 * Ratings are not emitted either: there is no markup without real, visible reviews.
 */
export function productJsonLd(product: Product, category?: Category, held: Held[] = []) {
  const url = absolute(paths.product(product.slug));
  const measured = !byPiece(product);
  const offer = (price: number, availability: Availability, sku: string) => ({
    "@type": "Offer",
    url,
    sku,
    price: plainPrice(price),
    priceCurrency: brand.currency,
    ...(measured
      ? {
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: plainPrice(price),
            priceCurrency: brand.currency,
            referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: product.unit },
          },
        }
      : {}),
    availability: SCHEMA_AVAILABILITY[product.type === "digital" ? "in_stock" : availability],
    ...(product.type === "physical" ? { itemCondition: "https://schema.org/NewCondition" } : {}),
    seller: { "@id": `${siteUrl()}/#organization` },
  });
  if (product.type === "service" && isEvent(product)) {
    // One `Event` per upcoming date. `location` is only stated when the business has an address:
    // it is never made up (search engines want it to show an event as a rich result).
    const capacity = serviceRules(product).capacity;
    const offers = (start: string, end: string) => ({
      "@type": "Offer", url, price: plainPrice(product.price), priceCurrency: brand.currency,
      availability: capacity - seatsOverlapping(held, product.id, start, end) > 0 ? SCHEMA_AVAILABILITY.in_stock : "https://schema.org/SoldOut",
    });
    const events = upcomingSessions(product, Date.now()).slice(0, 12).map((s) => ({
      "@context": "https://schema.org",
      "@type": "Event",
      name: product.name,
      description: product.description,
      url,
      image: product.images.map((i) => absolute(i.src)),
      startDate: s.start,
      endDate: s.end,
      eventStatus: "https://schema.org/EventScheduled",
      organizer: { "@id": `${siteUrl()}/#organization` },
      ...(brand.contact.address ? { location: { "@type": "Place", name: brand.name, address: brand.contact.address } } : {}),
      offers: offers(s.start, s.end),
    }));
    if (events.length > 0) return events.length === 1 ? events[0]! : events;
  }
  if (product.type === "service") {
    return {
      "@context": "https://schema.org",
      "@type": "Service",
      "@id": `${url}#service`,
      name: product.name,
      description: product.description,
      url,
      image: product.images.map((i) => absolute(i.src)),
      provider: { "@id": `${siteUrl()}/#organization` },
      ...(category ? { serviceType: category.name } : {}),
      offers: { "@type": "Offer", url, price: plainPrice(product.price), priceCurrency: brand.currency, availability: SCHEMA_AVAILABILITY.in_stock },
    };
  }
  const offers =
    product.variants.length > 0
      ? product.variants.map((v) => offer(unitPrice(product, v), availabilityOf(product, v), v.id))
      : [offer(product.price, productAvailability(product), product.id)];
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.description,
    sku: product.id,
    url,
    image: product.images.map((i) => absolute(i.src)),
    brand: { "@type": "Brand", name: brand.name },
    ...(category ? { category: category.name } : {}),
    // No public price → no offer at all.
    ...(product.type === "quote" ? {} : { offers: offers.length === 1 ? offers[0] : offers }),
  };
}

/** Safe to inline in a <script>: `<` cannot close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
