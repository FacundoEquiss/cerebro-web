// POST /api/events — the server half of the browser events (Meta Conversions API), sharing the
// `event_id` the pixel used so the platform counts ONE event. It is not an open door: only the
// store's own pages may call it, only three event names exist, the value is recomputed from the
// catalogue, and outside production nothing is sent at all.

import { NextResponse } from "next/server";
import { z } from "zod";
import { brand } from "@/config/brand";
import { sendServerEvent, serverAnalyticsOn } from "@/lib/analytics/server";
import { getProducts } from "@/lib/data";
import { unitPrice } from "@/lib/data/availability";
import { clientIp, hit, sameOrigin } from "@/lib/rate-limit";

const schema = z.object({
  name: z.enum(["view_item", "add_to_cart", "begin_checkout"]),
  eventId: z.string().min(8).max(80),
  url: z.string().max(500).optional(),
  items: z.array(z.object({ productId: z.string().max(120), variantId: z.string().max(160).nullish(), quantity: z.number().int().min(1).max(999) })).min(1).max(50),
  consent: z.literal("granted"),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(300).optional(),
  ga_client_id: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  if (!serverAnalyticsOn().meta) return new NextResponse(null, { status: 204 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "origin" }, { status: 403 });
  const ip = clientIp(request.headers);
  if (!hit(`event:${ip}`, 60, 60_000).allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = parsed.data;

  const products = await getProducts();
  const items = body.items.flatMap((i) => {
    const product = products.find((p) => p.id === i.productId);
    if (!product) return [];
    const variant = i.variantId ? product.variants.find((v) => v.id === i.variantId) : undefined;
    return [{ id: variant?.id ?? product.id, name: product.name, price: unitPrice(product, variant), quantity: i.quantity }];
  });
  if (items.length === 0) return new NextResponse(null, { status: 204 });

  await sendServerEvent(
    {
      name: body.name,
      eventId: body.eventId,
      value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      currency: brand.currency,
      items,
      url: body.url,
      user: { fbp: body.fbp, fbc: body.fbc, gaClientId: body.ga_client_id, ip, userAgent: request.headers.get("user-agent") ?? undefined },
    },
    "meta",
  );
  return new NextResponse(null, { status: 204 });
}
