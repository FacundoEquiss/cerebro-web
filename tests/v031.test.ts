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

  it("saves a free product, refuses an unmarked 0, and an order for it is 0 and can be confirmed with no payment", async () => {
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
    expect(order).toMatchObject({ total: 0, status: "new", paidAt: null });
    expect((await adapter.setOrderStatus(order.id, "new", "paid", "system", "free")).paidAt).not.toBeNull();
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
