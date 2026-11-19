// IndexNow: tell Bing (and the engines that share the protocol) that a page changed, so it is
// read again in hours instead of days. https://www.indexnow.org/documentation
// Google does not use it — it does not replace the sitemap.
//
//  · The key comes from INDEXNOW_KEY and is served at /indexnow-key.txt (app/indexnow-key.txt).
//  · Only from the production store, only canonical, indexable URLs of this site.
//  · Never throws and never delays a response: call it inside `after()` or from a script.

import { LOCALIZED_ROUTES, type RouteKey } from "@/i18n/routes";
import { locale } from "@/i18n";
import { env } from "@/lib/env";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

const NEVER: RouteKey[] = ["cart", "checkout", "order", "search"];

/** The canonical URL to notify, or `null` if that address must not be notified. Pure. */
export function notifiableUrl(pathOrUrl: string, siteUrl: string): string | null {
  const raw = pathOrUrl.trim();
  if (raw.includes("?") || raw.includes("#")) return null;
  let url: URL;
  try {
    url = raw.startsWith("/") || raw === "" ? new URL(raw || "/", siteUrl) : new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== new URL(siteUrl).origin) return null;
  const blocked = ["/api", "/_next", ...NEVER.map((k) => LOCALIZED_ROUTES[locale][k])];
  if (blocked.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null;
  return `${url.origin}${url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "")}`;
}

export async function notifyIndexNow(pathsOrUrls: string[]): Promise<{ sent: number; status: number | null }> {
  const e = env();
  if (!e.allowIndexing || !e.INDEXNOW_KEY) return { sent: 0, status: null };
  const urlList = [...new Set(pathsOrUrls.map((p) => notifiableUrl(p, e.siteUrl)).filter((u): u is string => u !== null))].slice(0, 10000);
  if (urlList.length === 0) return { sent: 0, status: null };
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(e.siteUrl).host, key: e.INDEXNOW_KEY, keyLocation: `${e.siteUrl}${INDEXNOW_KEY_PATH}`, urlList }),
      signal: AbortSignal.timeout(8000),
    });
    // The key is never logged.
    console.info(`[indexnow] ${urlList.length} url(s) → ${res.status}`);
    return { sent: urlList.length, status: res.status };
  } catch (err) {
    console.error("[indexnow] failed:", err instanceof Error ? err.message : err);
    return { sent: 0, status: null };
  }
}
