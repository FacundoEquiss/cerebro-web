// 0.3.1: free products (price 0 on purpose), closed days that win over the dates of an event,
// a corrupt `repeat.count`, and the dates the clocks skip.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { productInputSchema, toProductInput } from "@/lib/admin/products";
import { REPEAT_DEFAULT_COUNT, repeatCount, repeatDates, resolveSlot, upcomingSessions, type BookingRules } from "@/lib/booking/slots";
import { parseCatalog } from "@/lib/data/json";
import { feedable } from "@/lib/feeds";
import { priceOrder } from "@/lib/orders/pricing";
import { productJsonLd } from "@/lib/seo";
import { checkCatalog } from "../scripts/check-catalog.mjs";
import { product, request } from "./helpers";

describe("free products: price 0, on purpose", () => {
  const raw = (over: Record<string, unknown>) => ({ id: "x", slug: "x", name: "X", description: "", category: "c", images: [], ...over });
  const form = (over: Record<string, unknown>) => productInputSchema.safeParse({ slug: "gift", name: "Gift", description: "", category: "c", price: 0, compareAtPrice: null, stock: null, featured: false, active: true, minQuantity: 1, attributes: {}, images: [], options: [], variants: [], ...over });

  it("in the catalogue file: 0 with `free` is on sale; 0 without it is kept off the store", () => {
    const [gift, oops, paid, quote] = parseCatalog({ categories: [{ slug: "c", name: "C" }], products: [raw({ price: 0, free: true }), raw({ id: "o", slug: "o", price: 0 }), raw({ id: "p", slug: "p", price: 900, free: true }), raw({ id: "q", slug: "q", price: 0, type: "quote" })] } as never).products;
    expect(gift).toMatchObject({ free: true, draft: false, price: 0 });
    expect(oops).toMatchObject({ free: false, draft: true });
    expect(paid).toMatchObject({ free: false, draft: false, price: 900 }); // «free» with a price is not free
    expect(quote).toMatchObject({ free: false, draft: false });
  });

  it("in the form: «free» allows 0 and refuses a price; a quote is never «free»", () => {
    expect(form({ free: true }).success).toBe(true);
    expect(form({ free: true, price: 500 }).error?.issues[0]).toMatchObject({ path: ["price"], message: "free_has_price" });
    expect(form({}).error?.issues[0]).toMatchObject({ path: ["price"], message: "price_required" });
    expect(toProductInput(form({ free: true, type: "quote" }).data!).free).toBe(false);
    expect(toProductInput(form({ free: true, type: "digital", digital: { name: "gift.pdf" } }).data!)).toMatchObject({ free: true, price: 0, type: "digital" });
  });

  it("an order of free products adds up to 0; feeds leave them out; the structured data says 0", () => {
    const gift = product({ id: "gift", slug: "gift", price: 0, free: true, type: "digital", stock: null, digital: { name: "gift.pdf" } });
    const mug = product({ id: "mug", price: 1000 });
    expect(priceOrder(request({ shippingMethodId: "none", lines: [{ productId: "gift", quantity: 1 }] }), [gift]).total).toBe(0);
    expect(priceOrder(request({ lines: [{ productId: "gift", quantity: 1 }, { productId: "mug", quantity: 1 }] }), [gift, mug], undefined, { shipping: { price: 0, freeFrom: null } } as never).subtotal).toBe(1000);
    // A shopping feed needs a real price: a free product is not listed there.
    expect(feedable({ type: "physical", price: 0 })).toBe(false);
    expect(productJsonLd(gift)).toMatchObject({ "@type": "Product", offers: { price: "0.00", availability: "https://schema.org/InStock" } });
  });

  it("check:catalog: an unmarked 0 is an error that says how to mark it; free with a price too", () => {
    const root = mkdtempSync(join(tmpdir(), "free-"));
    mkdirSync(join(root, "content"));
    const run = (products: unknown[]) => {
      writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products }));
      return checkCatalog(root);
    };
    expect(run([raw({ price: 0, free: true })]).errors).toEqual([]);
    const unmarked = run([raw({ price: 0 })]).errors.join("\n");
    expect(unmarked).toContain('"free": true');
    expect(unmarked).toContain('"price": null');
    expect(run([raw({ price: 500, free: true })]).errors.join("\n")).toContain("marked free and has a price");
    expect(run([raw({ price: 0, free: "yes" })]).errors.join("\n")).toContain("`free` is true or false");
    expect(run([raw({ price: 0, type: "quote" }), raw({ id: "d", slug: "d", price: null })])).toMatchObject({ errors: [], drafts: ["d"] });
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the json adapter and free products", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "free-store-"));
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "false";
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DEMO_ORDERS;
  });

  it("saves a free product, refuses an unmarked 0, and an order for it is born paid", async () => {
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    const adapter = mod.jsonAdapter;
    const category = (await adapter.listCategories())[0]!.slug;
    const gift = product({ id: "gift", slug: "gift", category, price: 0, free: true, type: "digital", stock: null, digital: { name: "gift.pdf", file: "sample-guide.pdf" } });
    expect(await adapter.saveProduct(gift)).toMatchObject({ free: true, price: 0 });
    await expect(adapter.saveProduct({ ...gift, id: "oops", slug: "oops", free: false })).rejects.toMatchObject({ code: "invalid", detail: "price" });
    await expect(adapter.saveProduct({ ...gift, price: 300 })).rejects.toMatchObject({ code: "invalid", detail: "price" });
    expect((await adapter.listProducts()).find((p) => p.id === "gift")).toMatchObject({ free: true });
    const order = await adapter.createOrder(request({ idempotencyKey: "7".repeat(64), shippingMethodId: "none", lines: [{ productId: "gift", quantity: 1 }] }), { price: 0, freeFrom: null });
    // Born paid, in the same step that stored it: there is no second call that could fail.
    expect(order).toMatchObject({ total: 0, status: "paid" });
    expect(order.paidAt).not.toBeNull();
    const stored = (await adapter.getAdminOrder(order.id))!;
    expect(stored.history.map((h) => [h.type, h.to])).toEqual([["created", "new"], ["status", "paid"]]);
    expect(JSON.parse(readFileSync(join(dir, "orders.json"), "utf8"))[0]).toMatchObject({ id: order.id, status: "paid" });
    expect(JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8")).products.find((p: { id: string }) => p.id === "gift").free).toBe(true);
  });
});

describe("closed days, a corrupt count and the hour the clocks skip", () => {
  const rules: BookingRules = { timeZone: "America/Argentina/Buenos_Aires", weekly: {}, blockedDates: ["2027-01-02"], minNoticeHours: 0, maxDaysAhead: 60 };
  const now = Date.parse("2026-11-20T12:00:00Z");
  const event = (service: Record<string, unknown>) => product({ id: "class", type: "service", stock: null, service: { durationMinutes: 120, capacity: 4, ...service } as never });

  it("the closed days of the STORE skip a date of the rule, and the product can skip its own", () => {
    const p = event({ repeat: { week: 1, weekday: "sat", time: "10:00", count: 3 }, blockedDates: ["2026-12-05"] });
    // 5 Dec (the product's) and 2 Jan (the store's) are skipped: the rule moves on to the next ones.
    expect(upcomingSessions(p, now, rules).map((s) => s.slot)).toEqual(["2027-02-06T10:00", "2027-03-06T10:00", "2027-04-03T10:00"]);
  });

  it("a closed day wins over a date of the list too", () => {
    const p = event({ sessions: [{ start: "2027-01-02T10:00" }, { start: "2027-01-09T10:00" }, { start: "2027-01-16T10:00" }], blockedDates: ["2027-01-16"] });
    expect(upcomingSessions(p, now, rules).map((s) => s.slot)).toEqual(["2027-01-09T10:00"]);
    for (const slot of ["2027-01-02T10:00", "2027-01-16T10:00"]) expect(() => resolveSlot(p, slot, now, rules)).toThrowError(/slot_invalid/);
  });

  it("a `repeat.count` that is not a number gives the default number of dates, and the log says it once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const bad of ["3", null, Number.NaN, -2, 0, {}]) {
        expect(repeatDates({ week: "every", weekday: "sat", time: "10:00", count: bad as never }, now, "UTC"), String(bad)).toHaveLength(REPEAT_DEFAULT_COUNT);
      }
      const calls = warn.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      repeatCount("3");
      repeatCount("3");
      expect(warn.mock.calls.length).toBe(calls); // already said
      expect(String(warn.mock.calls[0]![0])).toContain("service.repeat.count");
      expect(repeatCount(undefined)).toBe(REPEAT_DEFAULT_COUNT);
      expect(repeatCount(5.9)).toBe(5);
      expect(repeatCount(500)).toBe(24);
    } finally {
      warn.mockRestore();
    }
  });

  it("check:catalog names the dates that will not be offered: on a closed day, or at an hour the clocks skip", () => {
    const root = mkdtempSync(join(tmpdir(), "closed-"));
    mkdirSync(join(root, "content"));
    mkdirSync(join(root, "config"));
    // New York: on 14 March 2027 the clocks jump from 02:00 to 03:00. The store closes on 4 July.
    writeFileSync(join(root, "config/commerce.ts"), `export const commerce = { booking: { timeZone: "America/New_York", blockedDates: ["2027-07-04"] as string[] } };\n`);
    const warnings = (service: Record<string, unknown>) => {
      writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [{ id: "class", slug: "class", name: "Class", category: "c", price: 10, images: [], type: "service", service: { durationMinutes: 60, capacity: 2, ...service } }] }));
      const result = checkCatalog(root, now);
      expect(result.errors, JSON.stringify(service)).toEqual([]);
      return result.warnings.join("\n");
    };
    const contradiction = warnings({ sessions: [{ start: "2027-05-01T10:00" }, { start: "2027-07-04T10:00" }, { start: "2027-06-05T10:00" }], blockedDates: ["2027-05-01"] });
    expect(contradiction).toContain("2027-05-01T10:00, 2027-07-04T10:00 is in `sessions` and its day is in `blockedDates`");
    expect(contradiction).toContain("the closed day wins");
    expect(warnings({ sessions: [{ start: "2027-06-05T10:00" }], blockedDates: ["2027-05-01"] })).not.toContain("closed day");
    // A rule at 02:30 every Sunday meets the skipped hour once a year.
    const gap = warnings({ repeat: { week: "every", weekday: "sun", time: "02:30" } });
    expect(gap).toContain("the rule falls on 2027-03-14");
    expect(gap).toContain("does not exist in America/New_York");
    expect(warnings({ repeat: { week: "every", weekday: "sun", time: "10:00" } })).not.toContain("does not exist");
    expect(warnings({ repeat: { week: "every", weekday: "sun", time: "02:30" }, blockedDates: ["2027-03-14", "2028-03-12"] })).not.toContain("does not exist");
    writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [{ id: "class", slug: "class", name: "Class", category: "c", price: 10, images: [], type: "service", service: { durationMinutes: 60, capacity: 2, blockedDates: "2027-05-01" } }] }));
    expect(checkCatalog(root, now).errors.join("\n")).toContain("service.blockedDates");
    rmSync(root, { recursive: true, force: true });
  });
});

// What the review of 0.3.1 reproduced: a total of 0 — confirmed as paid — with no free product in it.
describe("nothing is given away by accident (the JS side: priceOrder and the json adapter)", () => {
  const options = [{ id: "size", name: "Size", values: [{ id: "s", label: "S" }, { id: "m", label: "M" }] }];
  const tee = product({ id: "tee", price: 5000, options, stock: null, variants: [{ id: "tee-s", options: { size: "s" }, stock: null, price: 0 }, { id: "tee-m", options: { size: "m" }, stock: null, price: null }] });
  const rice = product({ id: "rice", price: 4, unit: "kg", step: 0.001, minQuantity: 0.001, stock: null });
  const sample = product({ id: "sample", price: 0, free: true, stock: null });
  const legacy = product({ id: "legacy", price: 0, stock: null }); // price 0, not free
  const terms = { price: 0, freeFrom: null };
  const price = (lines: { productId: string; quantity: number; variantId?: string }[], shipping = terms) => priceOrder(request({ shippingMethodId: "pickup", lines }), [tee, rice, sample, legacy], shipping);

  it("a line costs 0 only when its product is free", () => {
    expect(() => price([{ productId: "tee", variantId: "tee-s", quantity: 1 }])).toThrowError(/no_price/);
    expect(() => price([{ productId: "legacy", quantity: 1 }])).toThrowError(/no_price/);
    expect(() => price([{ productId: "rice", quantity: 0.001 }])).toThrowError(/quantity/); // 4 × 0.001 rounds to 0
    expect(price([{ productId: "rice", quantity: 0.5 }])).toMatchObject({ total: 2, nothingToPay: false });
    expect(price([{ productId: "tee", variantId: "tee-m", quantity: 1 }])).toMatchObject({ total: 5000, nothingToPay: false });
  });

  it("«nothing to pay» is every line free AND nothing charged — a free product with a paid one, or with shipping, is paid as usual", () => {
    expect(price([{ productId: "sample", quantity: 1 }])).toMatchObject({ total: 0, nothingToPay: true });
    expect(price([{ productId: "sample", quantity: 1 }, { productId: "rice", quantity: 1 }])).toMatchObject({ total: 4, nothingToPay: false });
    expect(price([{ productId: "sample", quantity: 1 }], { price: 6500, freeFrom: null })).toMatchObject({ total: 6500, nothingToPay: false });
  });

  it("the form refuses a variant at 0 on a priced product, and a priced variant on a free one", () => {
    const form = (over: Record<string, unknown>) => productInputSchema.safeParse({ slug: "tee", name: "Tee", description: "", category: "c", price: 5000, compareAtPrice: null, stock: null, featured: false, active: true, minQuantity: 1, attributes: {}, images: [], options, variants: [{ id: "tee-s", options: { size: "s" }, stock: null, price: 0 }], ...over });
    expect(form({}).error?.issues[0]).toMatchObject({ path: ["variants", 0, "price"], message: "variant_price_zero" });
    expect(form({ variants: [{ id: "tee-s", options: { size: "s" }, stock: null, price: null }] }).success).toBe(true);
    expect(form({ price: 0, free: true }).success).toBe(true);
    expect(form({ price: 0, free: true, variants: [{ id: "tee-s", options: { size: "s" }, stock: null, price: 300 }] }).error?.issues[0]).toMatchObject({ message: "free_has_price" });
  });

  it("the minimum order is about money: a cart of free products only is not held to it", async () => {
    const { commerce } = await import("@/config/commerce");
    const before = commerce.minimumOrder;
    (commerce as { minimumOrder: number }).minimumOrder = 1000;
    try {
      expect(price([{ productId: "sample", quantity: 1 }])).toMatchObject({ total: 0, nothingToPay: true });
      expect(() => price([{ productId: "sample", quantity: 1 }, { productId: "rice", quantity: 1 }])).toThrowError(/minimum_order/);
    } finally {
      (commerce as { minimumOrder: number }).minimumOrder = before;
    }
  });

  it("check:catalog and the doctor name the products at 0 that nobody marked, with the fix; a variant at 0 too", async () => {
    const { diagnose } = await import("../scripts/doctor.mjs");
    const root = mkdtempSync(join(tmpdir(), "unpriced-"));
    mkdirSync(join(root, "content"));
    const base = { name: "X", category: "c", images: [] };
    writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [
      { ...base, id: "old-gift", slug: "old-gift", price: 0 },
      { ...base, id: "tee", slug: "tee", price: 5000, options, variants: [{ id: "tee-s", options: { size: "s" }, stock: null, price: 0 }] },
      { ...base, id: "pin", slug: "pin", price: 0, free: true, options, variants: [{ id: "pin-s", options: { size: "s" }, stock: null, price: 300 }] },
    ] }));
    const result = checkCatalog(root);
    expect(result.unpriced).toEqual(["old-gift"]);
    expect(result.errors.join("\n")).toContain('the variant "tee-s" has price 0');
    expect(result.errors.join("\n")).toContain('is free and its variant "pin-s" has a price');
    const said = (diagnose(root, {}, "es").items as { ok: boolean | null; text: string }[]).find((i) => i.text.includes("old-gift"));
    expect(said).toMatchObject({ ok: false });
    expect(said!.text).toContain('"free": true');
    expect(said!.text).toContain("fuera de la venta");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the json adapter: free bookings and a catalogue saved before 0.3.1", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "free-seats-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DEMO_ORDERS;
  });

  it("one buyer cannot take every free place: seats per e-mail per date are capped, paid ones included", async () => {
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "false";
    const { commerce } = await import("@/config/commerce");
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    const adapter = mod.jsonAdapter;
    const category = (await adapter.listCategories())[0]!.slug;
    const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await adapter.saveProduct(product({ id: "open", slug: "open", category, type: "service", price: 0, free: true, stock: null, service: { durationMinutes: 60, capacity: 30, sessions: [{ start: `${day}T10:00` }, { start: `${day}T15:00` }] } }));
    let n = 0;
    const book = (email: string, seats: number, time = "10:00") => adapter.createOrder(request({ idempotencyKey: `s${++n}`.padEnd(64, "0"), shippingMethodId: "none", customer: { ...request().customer, email }, lines: [{ productId: "open", quantity: seats, slot: `${day}T${time}` }] }), { price: 0, freeFrom: null });
    const cap = commerce.booking.maxFreeSeatsPerBuyer;
    expect(await book("one@example.com", cap)).toMatchObject({ status: "paid" });
    await expect(book("one@example.com", 1)).rejects.toMatchObject({ code: "free_seat_limit", detail: String(cap) });
    await expect(book("ONE@example.com", 1)).rejects.toMatchObject({ code: "free_seat_limit" });
    await expect(book("two@example.com", cap + 1)).rejects.toMatchObject({ code: "free_seat_limit" });
    expect(await book("one@example.com", 1, "15:00")).toMatchObject({ status: "paid" });
    expect(await book("two@example.com", 1)).toMatchObject({ status: "paid" });
    // A paid (free) place does not lapse like an unpaid hold: it stays taken.
    const taken = (await adapter.listBookings(new Date(`${day}T00:00:00Z`).toISOString(), new Date(`${day}T23:59:00Z`).toISOString())).reduce((sum, b) => sum + b.seats, 0);
    expect(taken).toBe(cap + 2);
  });

  it("a catalogue saved before 0.3.1 with a product on sale at 0: kept off the store, shown as a draft in the panel", async () => {
    const old = mkdtempSync(join(tmpdir(), "old-catalog-"));
    process.env.DATA_DIR = old;
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    const first = (await mod.jsonAdapter.listAllProducts())[0]!;
    const { free: _f, ...legacy } = { ...first, id: "old-gift", slug: "old-gift", price: 0, draft: false, variants: [], options: [] };
    writeFileSync(join(old, "catalog.json"), JSON.stringify({ categories: await mod.jsonAdapter.listCategories(), products: [legacy, first] }));
    mod.resetJsonStore();
    expect((await mod.jsonAdapter.listProducts()).map((p) => p.id)).toEqual([first.id]);
    expect((await mod.jsonAdapter.listAllProducts()).find((p) => p.id === "old-gift")).toMatchObject({ draft: true, free: false });
    await expect(mod.jsonAdapter.createOrder(request({ idempotencyKey: "o".repeat(64), lines: [{ productId: "old-gift", quantity: 1 }] }), { price: 0, freeFrom: null })).rejects.toMatchObject({ code: "unknown_product" });
    rmSync(old, { recursive: true, force: true });
  });
});
