import type { MetadataRoute } from "next";
import { paths } from "@/i18n";
import { env } from "@/lib/env";

// Crawlers of AI assistants, named so the intent is explicit: they are WELCOME. A store that
// blocks them cannot be recommended by them. (They follow the same rules as everyone else.)
const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot",
  "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Amazonbot", "Bytespider", "meta-externalagent",
];

// Rendered on request, so ALLOW_INDEXING takes effect when the server starts.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const e = env();
  // Anything that is not the real store (previews, a laptop) is closed to every crawler.
  if (!e.allowIndexing) return { rules: [{ userAgent: "*", disallow: "/" }] };
  // Private or infinite pages. Never block here a URL that must be READ to be removed or
  // redirected (a 301, a 404): a blocked URL cannot be visited, so it stays indexed.
  const disallow = [paths.cart(), paths.checkout(), `${paths.order("")}`, "/api/", "/admin"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      { userAgent: AI_CRAWLERS, allow: "/", disallow },
    ],
    sitemap: `${e.siteUrl}/sitemap.xml`,
    host: e.siteUrl,
  };
}
