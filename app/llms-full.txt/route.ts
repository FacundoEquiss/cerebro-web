import { getCategories, getProducts } from "@/lib/data";
import { env } from "@/lib/env";
import { llmsFullTxt } from "@/lib/llms";

// Rendered on request: it follows the environment the server was STARTED with (site URL,
// production or not), not the one it was built with. The catalogue read behind it is cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);
  return new Response(llmsFullTxt(products, categories, env().siteUrl), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
