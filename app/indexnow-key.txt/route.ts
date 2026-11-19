import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** The IndexNow key file. It only exists when INDEXNOW_KEY is set. */
export function GET() {
  const key = env().INDEXNOW_KEY;
  if (!key) return new Response("Not found", { status: 404 });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
