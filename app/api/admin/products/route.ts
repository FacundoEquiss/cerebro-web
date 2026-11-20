// POST /api/admin/products — create or update a product.

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/admin/auth";
import { productInputSchema, toProductInput } from "@/lib/admin/products";
import { paths } from "@/i18n";
import { isEvent, seatsOverlapping, upcomingSessions } from "@/lib/booking/slots";
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
    const adapter = await data();
    const input = toProductInput(parsed.data);
    // Dates of an event that people already signed up for and that this change takes away.
    const now = Date.now();
    const before = (await adapter.listAllProducts()).find((p) => p.id === input.id);
    const { migrationNeeded, ...product } = await adapter.saveProduct(input);
    const moved: { slot: string; seats: number }[] = [];
    if (before && isEvent(before) && adapter.storesOrders) {
      const kept = new Set(isEvent(product) ? upcomingSessions(product, now).map((s) => `${s.start}|${s.end}`) : []);
      const gone = upcomingSessions(before, now).filter((s) => !kept.has(`${s.start}|${s.end}`));
      if (gone.length > 0) {
        const bookings = await adapter.listBookings(gone[0]!.start, gone.reduce((max, s) => (s.end > max ? s.end : max), gone[0]!.end));
        for (const s of gone) {
          const seats = seatsOverlapping(bookings, product.id, s.start, s.end);
          if (seats > 0) moved.push({ slot: s.slot, seats });
        }
      }
    }
    // The storefront is cached: drop it so the change shows right away.
    revalidatePath("/", "layout");
    if (product.active) void notifyIndexNow([paths.product(product.slug)]).catch(() => undefined);
    // `migration`: the save worked, and the database still needs that file (the panel says so).
    return NextResponse.json({ product, ...(moved.length > 0 ? { moved } : {}), ...(migrationNeeded ? { migration: migrationNeeded } : {}) });
  } catch (e) {
    if (e instanceof AdminError) return NextResponse.json({ error: e.code, ...(e.code === "invalid" && e.detail ? { field: e.detail } : {}), ...(e.code === "needs_migration" ? { migration: e.detail } : {}) }, { status: e.code === "slug_taken" || e.code === "needs_migration" ? 409 : 400 });
    if (e instanceof ReadOnlyError) return NextResponse.json({ error: "read_only" }, { status: 403 });
    console.error("[admin-product]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "generic" }, { status: 500 });
  }
}
