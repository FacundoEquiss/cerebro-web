// POST /api/admin/products — create or update a product.

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/admin/auth";
import { productInputSchema, toProductInput } from "@/lib/admin/products";
import { paths } from "@/i18n";
import { data } from "@/lib/data";
import { AdminError, ReadOnlyError } from "@/lib/data/types";
import { notifyIndexNow } from "@/lib/indexnow";

export async function POST(request: Request) {
  const guard = await requireWriter(request);
  if (guard.response) return guard.response;
  const parsed = productInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", field: parsed.error.issues[0]?.path.join(".") ?? "" }, { status: 400 });
  }
  try {
    const product = await (await data()).saveProduct(toProductInput(parsed.data));
    // The storefront is cached: drop it so the change shows right away.
    revalidatePath("/", "layout");
    if (product.active) void notifyIndexNow([paths.product(product.slug)]).catch(() => undefined);
    return NextResponse.json({ product });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.code }, { status: e.code === "slug_taken" ? 409 : 400 });
    if (e instanceof ReadOnlyError) return NextResponse.json({ error: "read_only" }, { status: 403 });
    console.error("[admin-product]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
