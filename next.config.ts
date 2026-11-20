import type { NextConfig } from "next";
import { brand as ownBrand } from "./config/brand";
import { brand as fixtureBrand } from "./tests/fixtures/config/brand";
import { redirects as customRedirects } from "./config/redirects";
import { INTERNAL_ROUTES, LOCALIZED_ROUTES, ROUTES_WITH_CHILDREN, type RouteKey } from "./i18n/routes";

// THE TESTS RUN AGAINST THEIR OWN STORE. With CEREBRO_FIXTURES=1 (set only by the end-to-end
// test server) the build reads the catalogue, the home texts, the brand and the commercial rules
// from tests/fixtures/ instead of the owner's files — through the path aliases of
// tsconfig.fixtures.json — so a store with any catalogue keeps a green test suite.
const fixtures = process.env.CEREBRO_FIXTURES === "1";
const brand = fixtures ? fixtureBrand : ownBrand;
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
  ...(fixtures ? { typescript: { tsconfigPath: "tsconfig.fixtures.json" } } : {}),
  // `output: "standalone"` makes `next build` emit a self-contained server (used by the Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: { NEXT_PUBLIC_APP_ENV: appEnv },
  images: { formats: ["image/avif", "image/webp"] },
  // `pg` is only loaded when DATA_SOURCE=postgres; keep it out of the bundles.
  serverExternalPackages: ["pg"],
  // The example files of the digital products are read from disk at request time: make sure
  // they travel with the server (serverless bundles and the standalone output).
  outputFileTracingIncludes: { "/api/downloads/**/*": ["./content/downloads/**/*"] },

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
