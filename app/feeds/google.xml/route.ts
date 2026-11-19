import { getCategories, getProducts } from "@/lib/data";
import { env } from "@/lib/env";
import { feedRows, googleFeedXml } from "@/lib/feeds";

// Rendered on request: it follows the environment the server was STARTED with (site URL,
// production or not), not the one it was built with. The catalogue read behind it is cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  const siteUrl = env().siteUrl;
  return new Response(googleFeedXml(feedRows(products, categories, siteUrl), siteUrl), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
