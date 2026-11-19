// Permanent (301) redirects: old URL → new URL. Add one line for every address that changes
// (a renamed product, the URLs of the previous site when migrating). `next.config.ts` reads it.
// A redirect is only useful if the old URL is NOT blocked in robots.txt.

export interface Redirect {
  source: string;
  destination: string;
}

export const redirects: Redirect[] = [
  // { source: "/old-product-url", destination: "/producto/new-slug" },
  { source: "/home", destination: "/" },
];
