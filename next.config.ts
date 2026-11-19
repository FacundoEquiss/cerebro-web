import type { NextConfig } from "next";
import { brand } from "./config/brand";
import { redirects as customRedirects } from "./config/redirects";
import { INTERNAL_ROUTES, LOCALIZED_ROUTES, ROUTES_WITH_CHILDREN, type RouteKey } from "./i18n/routes";

const localized = LOCALIZED_ROUTES[brand.locale];
const keys = Object.keys(INTERNAL_ROUTES) as RouteKey[];
const translated = keys.filter((k) => localized[k] !== INTERNAL_ROUTES[k]);

// "Production" = the real, public store. On Vercel it is detected on its own; on any other host
// set APP_ENV=production. Third-party trackers and indexing only switch on there.
const appEnv = process.env.VERCEL_ENV ?? process.env.APP_ENV ?? "development";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // A deliberately small policy that cannot break a payment form or a tracker. Before tightening
  // it (script-src, connect-src…), try the new policy with Content-Security-Policy-Report-Only.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `output: "standalone"` makes `next build` emit a self-contained server (used by the Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: { NEXT_PUBLIC_APP_ENV: appEnv },
  images: { formats: ["image/avif", "image/webp"] },
  // `pg` is only loaded when DATA_SOURCE=postgres; keep it out of the bundles.
  serverExternalPackages: ["pg"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  async redirects() {
    return [
      // `permanent: true` would answer 308; search engines and old clients understand 301 best.
      ...customRedirects.map((r) => ({ ...r, statusCode: 301 as const })),
      // The English filesystem route is not a public URL when the store speaks another language.
      ...translated.flatMap((k) => [
        { source: INTERNAL_ROUTES[k], destination: localized[k], statusCode: 301 as const },
        ...(ROUTES_WITH_CHILDREN.includes(k)
          ? [{ source: `${INTERNAL_ROUTES[k]}/:path*`, destination: `${localized[k]}/:path*`, statusCode: 301 as const }]
          : []),
      ]),
    ];
  },

  async rewrites() {
    return translated.flatMap((k) => [
      { source: localized[k], destination: INTERNAL_ROUTES[k] },
      ...(ROUTES_WITH_CHILDREN.includes(k)
        ? [{ source: `${localized[k]}/:path*`, destination: `${INTERNAL_ROUTES[k]}/:path*` }]
        : []),
    ]);
  },
};

export default nextConfig;
