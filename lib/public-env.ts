// The few values the BROWSER may know. Only `NEXT_PUBLIC_*` variables: they are baked into the
// JavaScript bundle at build time, so a secret must never be given that prefix.

export const publicEnv = {
  /** "production" only on the real, public store (see next.config.ts). */
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  ga4Id: process.env.NEXT_PUBLIC_GA4_ID || "",
  metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || "",
  clarityId: process.env.NEXT_PUBLIC_CLARITY_ID || "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
};

/**
 * MEASUREMENT IS OFF OUTSIDE PRODUCTION. Preview deployments, `next dev`, `next start` on a
 * laptop and the test suite must never send events: they would pollute the ad platforms'
 * learning with visits that are not customers.
 */
export const isProductionBuild = publicEnv.appEnv === "production";
export const analyticsConfigured =
  isProductionBuild && Boolean(publicEnv.ga4Id || publicEnv.metaPixelId || publicEnv.clarityId);
