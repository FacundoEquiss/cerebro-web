import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { brand } from "@/config/brand";
import { fontVariables } from "@/config/fonts";
import { languageTag, tr } from "@/i18n";
import { env } from "@/lib/env";
import "./globals.css";

export function generateMetadata(): Metadata {
  const e = env();
  return {
    metadataBase: new URL(e.siteUrl),
    // Pages give their own title; this template appends the brand once.
    title: { default: `${brand.name} — ${tr(brand.tagline)}`, template: `%s | ${brand.name}` },
    description: tr(brand.description),
    applicationName: brand.name,
    // Safe default: nothing is indexable until production says so (ALLOW_INDEXING=1).
    robots: e.allowIndexing ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: brand.name, locale: languageTag.replace("-", "_") },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: brand.theme.background,
};

// The theme of config/brand.ts, handed to the CSS as variables.
const theme = {
  "--background": brand.theme.background,
  "--surface": brand.theme.surface,
  "--ink": brand.theme.ink,
  "--muted": brand.theme.muted,
  "--line": brand.theme.line,
  "--action": brand.theme.action,
  "--on-action": brand.theme.onAction,
  "--highlight": brand.theme.highlight,
} as CSSProperties;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={languageTag} className={fontVariables} style={theme}>
      <body>{children}</body>
    </html>
  );
}
