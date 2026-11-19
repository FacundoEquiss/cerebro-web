// POST /api/admin/products/stock — the inline stock edit of the product list.

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWriter } from "@/lib/admin/auth";
import { data } from "@/lib/data";
import { AdminError, ReadOnlyError } from "@/lib/data/types";

const schema = z.object({
  productId: z.string().min(1).max(120),
  variantId: z.string().max(160).nullable(),
  /** null = made to order. */
  stock: z.number().int().min(0).max(1_000_000).nullable(),
});

export async function POST(request: Request) {
  const guard = await requireWriter(request);
  if (guard.response) return guard.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await (await data()).setStock(parsed.data.productId, parsed.data.variantId, parsed.data.stock);
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.code }, { status: 404 });
    if (e instanceof ReadOnlyError) return NextResponse.json({ error: "read_only" }, { status: 403 });
    console.error("[admin-stock]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
