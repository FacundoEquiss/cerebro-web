// Product types (0.2.0): sale by weight or measure, appointments, digital downloads, quotes and
// mixed carts — the pure rules, the `json` adapter end to end, the feeds and the structured data.
// The same rules in SQL are in tests/sql.test.ts.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commerce } from "@/config/commerce";
import { resolveLine, toCartCatalog } from "@/lib/cart-catalog";
import { lineKey } from "@/lib/cart-key";
import { addDays, openDates, resolveSlot, slotsOn, wallTime, weekdayOf, zonedInstant, type BookingRules } from "@/lib/booking/slots";
import { validQuantity } from "@/lib/data/availability";
import { parseCatalog } from "@/lib/data/json";
import type { DataAdapter, Product } from "@/lib/data/types";
import { feedable, feedRows, googleFeedXml, metaFeedXml } from "@/lib/feeds";
import { formatQuantity, formatUnitPrice, lineTotal } from "@/lib/format";
import { canDownload, downloadPath, verifyDownload } from "@/lib/orders/download";
import { normalizeLines } from "@/lib/orders/idempotency";
import { buildOrder, buildQuote, NO_SHIPPING, priceOrder, quoteTotals, requestNeedsShipping } from "@/lib/orders/pricing";
import { signReceipt, verifyReceipt } from "@/lib/orders/receipt";
import { orderRequestSchema, quoteRequestSchema } from "@/lib/orders/schema";
import { productJsonLd } from "@/lib/seo";
import { KEY, product, request } from "./helpers";

const coffee = product({ id: "coffee", slug: "coffee", name: "Coffee", price: 28000, unit: "kg", step: 0.25, minQuantity: 0.25, maxQuantity: 5, stock: 2 });
const tea = product({ id: "tea", slug: "tea", name: "Tea", price: 9.99, unit: "g", step: 1, minQuantity: 1, maxQuantity: 1000, stock: null });
const guide = product({ id: "guide", slug: "guide", name: "Guide", price: 7900, type: "digital", stock: null, digital: { name: "guide.pdf", file: "sample-guide.pdf" } });
const haircut = product({ id: "haircut", slug: "haircut", name: "Haircut", price: 12000, type: "service", stock: null, service: { durationMinutes: 30, capacity: 1 } });
const yoga = product({ id: "yoga", slug: "yoga", name: "Yoga", price: 6500, type: "service", stock: null, service: { durationMinutes: 60, capacity: 3 } });
const custom = product({ id: "custom", slug: "custom", name: "Custom tees", price: 0, type: "quote", stock: null, minQuantity: 10 });
const mug = product();
const catalog = [mug, coffee, tea, guide, haircut, yoga, custom];
const delivery = { price: 6500, freeFrom: 90000 };

// A fixed calendar for the pure tests: Monday to Friday 09–12, UTC, no notice, a week ahead.
const rules: BookingRules = { timeZone: "UTC", weekly: { mon: [["09:00", "12:00"]], tue: [["09:00", "12:00"]], wed: [["09:00", "12:00"]], thu: [["09:00", "12:00"]], fri: [["09:00", "12:00"]] }, blockedDates: ["2026-03-04"], minNoticeHours: 2, maxDaysAhead: 7 };
const monday = Date.parse("2026-03-02T08:00:00.000Z"); // a Monday, 08:00

/** A slot of the REAL calendar (config/commerce.ts) that can be booked right now. */
function freeSlot(p: Product, skip = 0): string {
  const day = openDates(p, Date.now())[1 + skip]!;
  return `${day}T${slotsOn(p, day, Date.now())[0]!.time}`;
}

const WHERE = { address: "Example Street 1", city: "Example City", postalCode: "0000" };

describe("sale by unit, weight or measure", () => {
  it("accepts multiples of the step between the minimum and the maximum, and nothing else", () => {
    for (const q of [0.25, 0.5, 0.75, 1, 2.5, 5]) expect(validQuantity(coffee, q, 20)).toBe(true);
    for (const q of [0, -1, 0.1, 0.3, 0.26, 5.25, Number.NaN, Number.POSITIVE_INFINITY]) expect(validQuantity(coffee, q, 20)).toBe(false);
    // Without its own maximum the store's default applies.
    expect(validQuantity(product({ step: 1 }), 21, 20)).toBe(false);
    // Float noise is not a reason to refuse 0.1 + 0.2.
    expect(validQuantity(product({ unit: "kg", step: 0.1, minQuantity: 0.1 }), 0.1 + 0.2, 20)).toBe(true);
  });

  it("the server rejects an invalid weight and never trusts a price in the request", () => {
    for (const quantity of [0.3, 0.1, 6, -0.25]) {
      expect(() => priceOrder(request({ lines: [{ productId: "coffee", quantity }] }), catalog, delivery)).toThrowError(/quantity/);
    }
    const lines = [{ productId: "coffee", quantity: 0.75, unitPrice: 1, price: 1 }] as never;
    expect(priceOrder(request({ lines }), catalog, { price: 0, freeFrom: null })).toMatchObject({ subtotal: 21000, total: 21000 });
  });

  it("rounds each line to cents on its own and adds the rounded lines", () => {
    // 333 g × 9.99 = 3326.67 exactly; 0.75 kg × 28000 = 21000.
    const priced = priceOrder(request({ lines: [{ productId: "tea", quantity: 333 }, { productId: "coffee", quantity: 0.75 }], shippingMethodId: "pickup" }), catalog, { price: 0, freeFrom: null });
    expect(priced.lines.map(lineTotal)).toEqual([3326.67, 21000]);
    expect(priced.subtotal).toBe(24326.67);
    // 7 g × 9.99 = 69.93; 3 lines of 0.335 would drift without rounding per line.
    const odd = product({ id: "odd", price: 0.335, unit: "g", step: 1, stock: null, maxQuantity: 10 });
    const three = priceOrder({ lines: [{ productId: "odd", quantity: 1 }, { productId: "odd", quantity: 1 }, { productId: "odd", quantity: 1 }], shippingMethodId: "pickup" }, [odd], { price: 0, freeFrom: null });
    expect(three.subtotal).toBe(1.02); // 0.34 + 0.34 + 0.34, what the customer sees line by line
  });

  it("takes decimal stock, across lines", () => {
    expect(() => priceOrder(request({ lines: [{ productId: "coffee", quantity: 1.25 }, { productId: "coffee", quantity: 1 }] }), catalog, delivery)).toThrowError(/out_of_stock/);
    expect(priceOrder(request({ lines: [{ productId: "coffee", quantity: 1.25 }, { productId: "coffee", quantity: 0.75 }] }), catalog, delivery).subtotal).toBe(56000);
  });

  it("shows the price per unit of measure and keeps decimal quantities through the checkout", () => {
    expect(formatUnitPrice(28000, "kg")).toMatch(/28[.,]?000\s*\/ kg$/);
    expect(formatUnitPrice(1000, "u")).not.toContain("/");
    expect(formatQuantity(0.75, "kg")).toBe("0,75 kg");
    expect(formatQuantity(3, "u")).toBe("3");
    expect(normalizeLines([{ productId: "coffee", quantity: 0.7500001 }])[0]!.quantity).toBe(0.75);
    expect(orderRequestSchema.shape.lines.element.safeParse({ productId: "coffee", quantity: 0.75 }).success).toBe(true);
    expect(orderRequestSchema.shape.lines.element.safeParse({ productId: "coffee", quantity: 0 }).success).toBe(false);
    // The cart snaps a saved quantity to what can be bought today.
    const line = resolveLine({ key: "coffee", productId: "coffee", variantId: null, selection: {}, quantity: 0.6 }, toCartCatalog(catalog));
    expect(line).toMatchObject({ quantity: 0.5, min: 0.25, step: 0.25, max: 2, unit: "kg" });
  });
});

describe("appointments: the slots of a service", () => {
  it("offers the slots of the opening hours, in the store's time zone", () => {
    const slots = slotsOn(haircut, "2026-03-03", monday, rules);
    expect(slots.map((s) => s.time)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(slots[0]).toMatchObject({ start: "2026-03-03T09:00:00.000Z", end: "2026-03-03T09:30:00.000Z" });
    // A slot never runs past closing time.
    expect(slotsOn(yoga, "2026-03-03", monday, rules).map((s) => s.time)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("closes weekends, blocked days, the past, short notice and what is too far ahead", () => {
    expect(weekdayOf("2026-03-07")).toBe("sat");
    expect(slotsOn(haircut, "2026-03-07", monday, rules)).toEqual([]);
    expect(slotsOn(haircut, "2026-03-04", monday, rules)).toEqual([]); // blocked
    expect(slotsOn(haircut, "2026-03-01", monday, rules)).toEqual([]); // yesterday
    expect(slotsOn(haircut, "2026-03-12", monday, rules)).toEqual([]); // beyond the window
    // It is 08:00 with two hours of notice: 09:00 and 09:30 are gone, 10:00 is the first.
    expect(slotsOn(haircut, "2026-03-02", monday, rules)[0]!.time).toBe("10:00");
    expect(openDates(haircut, monday, rules)).toEqual(["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06", "2026-03-09"]);
    // A product may have its own hours and its own closed days.
    const own = product({ type: "service", service: { durationMinutes: 60, capacity: 1, weekly: { sat: [["10:00", "12:00"]] }, blockedDates: ["2026-03-07"] } });
    expect(openDates(own, monday, { ...rules, maxDaysAhead: 14 })).toEqual(["2026-03-14"]);
  });

  it("stores exact instants: a time zone and its daylight saving cannot move an appointment", () => {
    expect(zonedInstant("2026-03-03", "09:00", "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-03-03T12:00:00.000Z");
    // New York: winter (UTC-5) and summer (UTC-4).
    expect(zonedInstant("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedInstant("2026-07-15", "09:00", "America/New_York").toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(wallTime("2026-07-15T13:00:00.000Z", "America/New_York")).toEqual({ date: "2026-07-15", time: "09:00" });
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("the server accepts only a slot the service really offers", () => {
    expect(resolveSlot(haircut, "2026-03-03T09:30", monday, rules)).toEqual({ start: "2026-03-03T09:30:00.000Z", end: "2026-03-03T10:00:00.000Z" });
    expect(() => resolveSlot(haircut, null, monday, rules)).toThrowError(/slot_required/);
    for (const slot of ["2026-03-03T09:15", "2026-03-03T12:00", "2026-03-07T09:00", "2026-03-04T09:00", "2026-03-01T09:00", "nonsense", "2026-03-03"]) {
      expect(() => resolveSlot(haircut, slot, monday, rules)).toThrowError(/slot_invalid/);
    }
  });

  it("checks the capacity of the slot, also across the lines of one order", () => {
    const slot = freeSlot(yoga);
    const start = resolveSlot(yoga, slot, Date.now()).start;
    const end = resolveSlot(yoga, slot, Date.now()).end;
    const book = (quantity: number, seats = 0) =>
      priceOrder(request({ lines: [{ productId: "yoga", quantity, slot }] }), catalog, delivery, { held: seats ? [{ productId: "yoga", start, end, seats }] : [] });
    expect(book(3).lines[0]).toMatchObject({ type: "service", quantity: 3, slot: { start } });
    expect(() => book(4)).toThrowError(/slot_taken/);
    expect(() => book(2, 2)).toThrowError(/slot_taken/);
    expect(book(1, 2).total).toBe(6500);
    // Seats are whole.
    expect(() => book(1.5)).toThrowError(/quantity/);
    // A service without its slot is not an order.
    expect(() => priceOrder(request({ lines: [{ productId: "haircut", quantity: 1 }] }), catalog, delivery)).toThrowError(/slot_required/);
    // Two different appointments of one service are two cart lines.
    expect(lineKey("haircut", null, {}, [], "2026-03-03T09:00")).not.toBe(lineKey("haircut", null, {}, [], "2026-03-03T09:30"));
  });
});

describe("mixed carts: shipping only if something is shipped", () => {
  const slot = () => freeSlot(haircut);
  it("charges no shipping for services and downloads, whatever method the browser sends", () => {
    const priced = priceOrder(request({ lines: [{ productId: "guide", quantity: 1 }, { productId: "haircut", quantity: 1, slot: slot() }], shippingMethodId: "delivery" }), catalog, delivery);
    expect(priced).toMatchObject({ shippingMethodId: NO_SHIPPING, shippingPrice: 0, subtotal: 19900, total: 19900 });
    expect(buildOrder("P-1", request(), priced, "2026-01-01T00:00:00.000Z").shipping).toEqual({ methodId: "none", price: 0 });
    // …even with a method that does not exist: nothing is shipped, so none is needed.
    expect(priceOrder({ lines: [{ productId: "guide", quantity: 1 }], shippingMethodId: "nope" }, catalog).total).toBe(7900);
  });

  it("charges the shipping once when the cart has at least one physical product", () => {
    const priced = priceOrder(request({ lines: [{ productId: "guide", quantity: 1 }, { productId: "mug", quantity: 1 }, { productId: "haircut", quantity: 1, slot: slot() }], shippingMethodId: "delivery" }), catalog, delivery);
    expect(priced).toMatchObject({ shippingMethodId: "delivery", shippingPrice: 6500, subtotal: 20900, total: 27400 });
    expect(priced.lines.map((l) => l.type)).toEqual(["digital", "physical", "service"]);
  });

  it("decides it from the catalogue, never from the request", () => {
    expect(requestNeedsShipping([{ productId: "guide" }, { productId: "haircut" }], catalog)).toBe(false);
    expect(requestNeedsShipping([{ productId: "guide" }, { productId: "coffee" }], catalog)).toBe(true);
    // An unknown product is treated as shipped: the order will fail on it anyway.
    expect(requestNeedsShipping([{ productId: "ghost" }], catalog)).toBe(true);
  });
});

describe("digital products: the download link", () => {
  const secret = "s".repeat(40);
  const now = Date.parse("2026-03-02T10:00:00.000Z");
  const parse = (path: string) => {
    const url = new URL(path, "https://www.example.com");
    return { e: url.searchParams.get("e"), s: url.searchParams.get("s") };
  };

  it("is signed for one line of one order and expires", () => {
    const { e, s } = parse(downloadPath("P-ABC", 0, secret, 72, now));
    expect(verifyDownload("P-ABC", 0, e, s, secret, now)).toEqual({ ok: true });
    expect(verifyDownload("P-ABC", 0, e, s, secret, now + 71 * 3_600_000)).toEqual({ ok: true });
    expect(verifyDownload("P-ABC", 0, e, s, secret, now + 73 * 3_600_000)).toEqual({ ok: false, reason: "expired" });
    // Another order, another line, a longer life or another key: the signature does not hold.
    expect(verifyDownload("P-XYZ", 0, e, s, secret, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyDownload("P-ABC", 1, e, s, secret, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyDownload("P-ABC", 0, String(Number(e) + 999999), s, secret, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyDownload("P-ABC", 0, e, s, "x".repeat(40), now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyDownload("P-ABC", 0, null, null, secret, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("is handed over only for a paid order that was not cancelled", () => {
    expect(canDownload({ paidAt: null, status: "new" })).toBe(false);
    expect(canDownload({ paidAt: "2026-03-02T10:00:00.000Z", status: "paid" })).toBe(true);
    expect(canDownload({ paidAt: "2026-03-02T10:00:00.000Z", status: "delivered" })).toBe(true);
    expect(canDownload({ paidAt: "2026-03-02T10:00:00.000Z", status: "cancelled" })).toBe(false);
    expect(canDownload({ paidAt: null, status: "quote" })).toBe(false);
    expect(canDownload(null)).toBe(false);
  });

  it("keeps the files out of public/ and the storage key out of the storefront", () => {
    expect(existsSync("content/downloads/sample-guide.pdf")).toBe(true);
    const everything = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? everything(join(dir, f.name)) : [join(dir, f.name)]));
    expect(everything("public").filter((f) => /\.(pdf|zip|epub)$/i.test(f))).toEqual([]);
  });
});

describe("quotes: products without a public price", () => {
  it("are never bought from the cart, and only they can be asked for", () => {
    expect(() => priceOrder(request({ lines: [{ productId: "custom", quantity: 10 }] }), catalog, delivery)).toThrowError(/quote_only/);
    expect(resolveLine({ key: "custom", productId: "custom", variantId: null, selection: {}, quantity: 10 }, toCartCatalog(catalog))).toBeNull();
    const quote = { idempotencyKey: KEY, productId: "custom", quantity: 40, detail: "Forty tees with our logo", customer: request().customer };
    expect(() => buildQuote("P-1", { ...quote, productId: "mug" }, catalog, "2026-01-01T00:00:00.000Z")).toThrowError(/not_a_quote/);
    expect(() => buildQuote("P-1", { ...quote, quantity: 5 }, catalog, "2026-01-01T00:00:00.000Z")).toThrowError(/quantity/);
    const order = buildQuote("P-1", quote, catalog, "2026-01-01T00:00:00.000Z");
    expect(order).toMatchObject({ status: "quote", total: 0, subtotal: 0, quote: { sentAt: null }, shipping: { methodId: "none", price: 0 } });
    expect(order.lines[0]).toMatchObject({ type: "quote", quantity: 40, unitPrice: 0, note: "Forty tees with our logo" });
  });

  it("the browser sends what is wanted, never an amount", () => {
    const parsed = quoteRequestSchema.safeParse({ idempotencyKey: KEY, productId: "custom", quantity: 40, detail: "Forty tees", customer: request().customer, price: 1, total: 1 });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("price");
    expect(parsed.data).not.toHaveProperty("total");
    expect(quoteRequestSchema.safeParse({ idempotencyKey: KEY, productId: "custom", quantity: 40, detail: "", customer: request().customer }).success).toBe(false);
  });

  it("adds a priced quote line by line", () => {
    expect(quoteTotals([{ quantity: 40 }, { quantity: 2.5 }], [1250.5, 999.99], 5000)).toEqual({ subtotal: 52519.98, shipping: 5000, total: 57519.98 });
    expect(quoteTotals([{ quantity: 40 }], [-5], -1)).toEqual({ subtotal: 0, shipping: 0, total: 0 });
  });
});

describe("the json adapter, end to end", () => {
  let dir: string;
  let adapter: DataAdapter;
  let key = 0;
  const nextKey = () => (++key).toString(16).padStart(64, "0");
  /** A different buyer each time: the limit of unpaid appointments is per e-mail. */
  const buyer = () => ({ ...request().customer, email: `buyer${++key}@example.com` });
  const free = { price: 0, freeFrom: null };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "types-"));
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "false";
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    adapter = mod.jsonAdapter;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DEMO_ORDERS;
  });

  const service = async (id: string) => (await adapter.listProducts()).find((p) => p.id === id)!;
  const book = (productId: string, slot: string, quantity = 1) =>
    adapter.createOrder(request({ idempotencyKey: nextKey(), customer: buyer(), lines: [{ productId, quantity, slot }], shippingMethodId: "none" }), free);

  it("ships a demo with one product of every type, the file key hidden from the store", async () => {
    const products = await adapter.listProducts();
    expect(new Set(products.map((p) => p.type))).toEqual(new Set(["physical", "digital", "service", "quote"]));
    expect(products.some((p) => p.unit === "kg" && p.step < 1)).toBe(true);
    const digital = products.find((p) => p.type === "digital")!;
    expect(digital.digital).toEqual({ name: expect.any(String) });
    expect(await adapter.getDigitalFile(digital.id)).toMatchObject({ file: expect.stringMatching(/^sample-/) });
    expect(await adapter.getDigitalFile("taza-de-ceramica")).toBeNull();
  });

  it("never oversells a slot, even with simultaneous orders", async () => {
    const haircutDemo = await service("corte-de-pelo");
    const slot = freeSlot(haircutDemo);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => book("corte-de-pelo", slot)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "slot_taken" });
    const start = resolveSlot(haircutDemo, slot, Date.now()).start;
    const bookings = (await adapter.listBookings(start, new Date(Date.parse(start) + 1000).toISOString())).filter((b) => b.productId === "corte-de-pelo");
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ seats: 1, paid: false, orderStatus: "new", customerName: "Ana Example" });
  });

  it("fills a group class up to its capacity and not one seat more", async () => {
    const yogaDemo = await service("clase-grupal-de-yoga");
    const capacity = yogaDemo.service!.capacity;
    const slot = freeSlot(yogaDemo);
    const results = await Promise.allSettled(Array.from({ length: capacity + 4 }, () => book("clase-grupal-de-yoga", slot)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(capacity);
  });

  it("is idempotent: a retry is the same booking, not a second seat", async () => {
    const slot = freeSlot(await service("corte-de-pelo"), 1);
    const body = request({ idempotencyKey: nextKey(), customer: buyer(), lines: [{ productId: "corte-de-pelo", quantity: 1, slot }], shippingMethodId: "none" });
    const first = await adapter.createOrder(body, free);
    const again = await adapter.createOrder(body, free);
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ shipping: { methodId: "none", price: 0 }, total: 12000 });
  });

  it("frees the slot when the order is cancelled or expires", async () => {
    const slot = freeSlot(await service("corte-de-pelo"), 2);
    const order = await book("corte-de-pelo", slot);
    await expect(book("corte-de-pelo", slot)).rejects.toMatchObject({ code: "slot_taken" });
    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "changed plans");
    const second = await book("corte-de-pelo", slot);
    // …and an order nobody paid stops holding it after the deadline.
    vi.useFakeTimers({ now: Date.now() + 3 * 3_600_000, toFake: ["Date"] });
    try {
      expect(await adapter.expireOrders(2, "Expired")).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
    expect((await adapter.getOrder(second.id))?.status).toBe("cancelled");
    expect((await book("corte-de-pelo", slot)).status).toBe("new");
  });

  it("sells by weight: decimal stock goes down and comes back", async () => {
    const stock = async () => (await adapter.listAllProducts()).find((p) => p.id === "mix-de-frutos-secos")!.stock!;
    const before = await stock();
    // Sold in steps of 100 g: a quarter kilo is not a quantity of this product.
    await expect(adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "mix-de-frutos-secos", quantity: 0.25 }] }), free)).rejects.toMatchObject({ code: "quantity" });
    const order = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "mix-de-frutos-secos", quantity: 0.7 }] }), free);
    expect(order.lines[0]).toMatchObject({ quantity: 0.7, unit: "kg", unitPrice: 19500 });
    expect(order.subtotal).toBe(13650);
    expect(await stock()).toBe(before - 0.7);
    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "x");
    expect(await stock()).toBe(before);
    // Coffee declares a grind and has no variants: it is made to order, by the quarter kilo.
    const coffeeOrder = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "cafe-en-grano", quantity: 0.75, selection: { molienda: "grano" } }] }), free);
    expect(coffeeOrder).toMatchObject({ subtotal: 21000, lines: [{ quantity: 0.75, unitPrice: 28000, variantLabel: "En grano" }] });
  });

  it("a quote cannot be accepted before it is sent, nor for a price that changed", async () => {
    const enquiry = await adapter.createQuote({ idempotencyKey: nextKey(), productId: "camisetas-estampadas-para-eventos", quantity: 40, detail: "Forty tees with our logo", customer: request().customer });
    expect(enquiry).toMatchObject({ status: "quote", total: 0, quote: { sentAt: null } });
    await expect(adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "camisetas-estampadas-para-eventos", quantity: 40 }] }), free)).rejects.toMatchObject({ code: "quote_only" });

    // Not priced, not sent: nothing to accept.
    await expect(adapter.acceptQuote(enquiry.id, 0, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });
    await expect(adapter.sendQuote(enquiry.id, "owner@example.com")).rejects.toMatchObject({ code: "quote_incomplete" });

    // Priced but not sent: still nothing to accept.
    const priced = await adapter.setQuote(enquiry.id, { prices: [9500], shipping: 6000 }, "owner@example.com");
    expect(priced).toMatchObject({ subtotal: 380000, total: 386000, quote: { sentAt: null }, status: "quote" });
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });

    const sent = await adapter.sendQuote(enquiry.id, "owner@example.com");
    expect(sent.quote?.sentAt).toEqual(expect.any(String));
    // A total that is not the one that was sent (a tampered form, or an old page).
    for (const total of [1, 385999.99, 0, Number.NaN]) {
      await expect(adapter.acceptQuote(enquiry.id, total, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_changed" });
    }
    // The owner changes the price after sending: the quote is no longer sent.
    await adapter.setQuote(enquiry.id, { prices: [9000], shipping: 6000 }, "owner@example.com");
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });
    await adapter.sendQuote(enquiry.id, "owner@example.com");
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_changed" });
    expect((await adapter.getOrder(enquiry.id))?.status).toBe("quote");

    // The exact total that was sent: now it is a normal order, and accepting again changes nothing.
    // It charges shipping: without the delivery address it is not accepted.
    await expect(adapter.acceptQuote(enquiry.id, 366000, "manual", "whatsapp")).rejects.toMatchObject({ code: "address_required" });
    await expect(adapter.acceptQuote(enquiry.id, 366000, "manual", "whatsapp", { address: "Example Street 1", city: " ", postalCode: "0000" })).rejects.toMatchObject({ code: "address_required" });
    const accepted = await adapter.acceptQuote(enquiry.id, 366000, "manual", "whatsapp", WHERE);
    expect((await adapter.getAdminOrder(enquiry.id))?.customer).toMatchObject(WHERE);
    expect(accepted).toMatchObject({ status: "new", total: 366000, paymentMethod: "whatsapp", paidAt: null });
    expect((await adapter.acceptQuote(enquiry.id, 366000, "manual", "bank_transfer", WHERE)).paymentMethod).toBe("whatsapp");
    await expect(adapter.setQuote(enquiry.id, { prices: [1], shipping: 0 }, "owner@example.com")).rejects.toMatchObject({ code: "conflict" });
    const paid = await adapter.setOrderStatus(enquiry.id, "new", "paid", "owner@example.com");
    expect(paid.history.map((e) => e.type)).toEqual(["created", "quote", "quote", "quote", "quote", "status", "status"]);
  });

  it("an enquiry never expires as an unpaid order; an accepted one counts from the acceptance", async () => {
    const enquiry = await adapter.createQuote({ idempotencyKey: nextKey(), productId: "mueble-a-medida", quantity: 1, detail: "A table of 1.60 by 0.80", customer: request().customer });
    await adapter.setQuote(enquiry.id, { prices: [185000], shipping: 0 }, "owner@example.com");
    await adapter.sendQuote(enquiry.id, "owner@example.com");
    vi.useFakeTimers({ now: Date.now() + 100 * 3_600_000, toFake: ["Date"] });
    try {
      await adapter.expireOrders(48, "Expired");
      expect((await adapter.getOrder(enquiry.id))?.status).toBe("quote");
      // Accepted four days after it was asked: the 48 hours start NOW.
      await adapter.acceptQuote(enquiry.id, 185000, "manual", "bank_transfer");
      expect(await adapter.expireOrders(48, "Expired")).toBe(0);
      expect((await adapter.getOrder(enquiry.id))?.status).toBe("new");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the download is not delivered before the payment, and the link expires", async () => {
    const { GET } = await import("@/app/api/downloads/[id]/[line]/route");
    const { env } = await import("@/lib/env");
    const order = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "guia-en-pdf", quantity: 1 }], shippingMethodId: "delivery" }), { price: 6500, freeFrom: null });
    expect(order).toMatchObject({ total: 7900, shipping: { methodId: "none", price: 0 } });
    const get = (path: string) => {
      const url = new URL(path, "http://localhost:3000");
      const [, , , id, line] = url.pathname.split("/");
      return GET(new Request(url), { params: Promise.resolve({ id: decodeURIComponent(id!), line: line! }) });
    };
    const link = downloadPath(order.id, 0, env().orderSecret, 72);

    // A perfectly signed link, an order nobody paid: no file.
    const early = await get(link);
    expect(early.status).toBe(403);
    expect(await early.json()).toEqual({ error: "not_paid" });

    // The owner marks it as paid: now the same link delivers the file, privately.
    await adapter.setOrderStatus(order.id, "new", "paid", "owner@example.com");
    const ok = await get(link);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("content-disposition")).toContain("attachment");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // An expired link, a forged one, and a line that is not a download.
    expect((await get(downloadPath(order.id, 0, env().orderSecret, 72, Date.now() - 73 * 3_600_000))).status).toBe(410);
    expect((await get(link.replace(/s=.{6}/, "s=AAAAAA"))).status).toBe(403);
    expect((await get(downloadPath(order.id, 5, env().orderSecret, 72))).status).toBe(404);
    // Cancelled afterwards: the link stops working.
    await adapter.setOrderStatus(order.id, "paid", "cancelled", "owner@example.com", "refunded");
    expect((await get(link)).status).toBe(403);
  });

  it("the paid e-mail carries the download links, the unpaid one does not", async () => {
    const { downloadLinks } = await import("@/lib/orders/notify");
    const order = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "guia-en-pdf", quantity: 1 }, { productId: "taza-de-ceramica", variantId: "taza-de-ceramica-white", quantity: 1 }] }), free);
    expect(downloadLinks(order)).toBe("");
    await adapter.setOrderStatus(order.id, "new", "paid", "owner@example.com");
    const text = downloadLinks((await adapter.getOrder(order.id))!);
    expect(text).toMatch(new RegExp(`/api/downloads/${order.id}/0\\?e=\\d+&s=`));
    expect(text).not.toContain(`/api/downloads/${order.id}/1`); // the mug is not a download
  });
});

describe("the signed receipt", () => {
  it("carries the type, the unit and the slot of each line, and stays short for plain orders", () => {
    const secret = "r".repeat(40);
    const slot = freeSlot(haircut);
    const priced = priceOrder(request({ lines: [{ productId: "mug", quantity: 1 }, { productId: "coffee", quantity: 0.5 }, { productId: "haircut", quantity: 1, slot }] }), catalog, delivery);
    const order = buildOrder("P-ABC", request(), priced, "2026-01-01T00:00:00.000Z");
    const read = verifyReceipt(signReceipt(order, secret), secret);
    expect(read.ok && read.order).toEqual(order);
    const plain = buildOrder("P-ABC", request(), priceOrder(request(), catalog, delivery), "2026-01-01T00:00:00.000Z");
    expect(Buffer.from(signReceipt(plain, secret).split(".")[1]!, "base64url").toString()).not.toMatch(/"slot"|"unit"|"type"|"quote"/);
  });
});

describe("feeds and structured data per product type", () => {
  const categories = [{ slug: "home", name: "Home", description: "" }];
  const site = "https://www.example.com";

  it("lists only physical products with a price", () => {
    expect(catalog.filter(feedable).map((p) => p.id)).toEqual(["mug", "coffee", "tea"]);
    expect(feedable(product({ price: 0 }))).toBe(false);
    const rows = feedRows(catalog, categories, site);
    expect(rows.map((r) => r.id)).toEqual(["mug", "coffee", "tea"]);
    for (const xml of [googleFeedXml(rows, site), metaFeedXml(rows, site)]) {
      for (const id of ["guide", "haircut", "yoga", "custom"]) expect(xml).not.toContain(`<g:id>${id}</g:id>`);
      expect(xml).not.toContain("<g:price>0.00");
      expect(xml).toContain("<g:unit_pricing_measure>1 kg</g:unit_pricing_measure>");
    }
  });

  it("describes each type with the right schema.org type — and no price where there is none", () => {
    const physical = productJsonLd(mug) as Record<string, unknown>;
    expect(physical).toMatchObject({ "@type": "Product", offers: { "@type": "Offer", price: "1000.00", itemCondition: "https://schema.org/NewCondition" } });

    const weight = productJsonLd(coffee) as { offers: Record<string, unknown> };
    expect(weight.offers.priceSpecification).toMatchObject({ "@type": "UnitPriceSpecification", price: "28000.00", referenceQuantity: { value: 1, unitText: "kg" } });

    const digital = productJsonLd(guide) as { offers: Record<string, unknown> };
    expect(digital).toMatchObject({ "@type": "Product", offers: { price: "7900.00", availability: "https://schema.org/InStock" } });
    expect(digital.offers).not.toHaveProperty("itemCondition");
    expect(JSON.stringify(digital)).not.toContain("sample-guide"); // the storage key never leaves the server

    const serviceLd = productJsonLd(haircut) as Record<string, unknown>;
    expect(serviceLd).toMatchObject({ "@type": "Service", provider: { "@id": expect.stringContaining("#organization") }, offers: { "@type": "Offer", price: "12000.00" } });
    expect(serviceLd).not.toHaveProperty("sku");

    const quote = productJsonLd(custom) as Record<string, unknown>;
    expect(quote["@type"]).toBe("Product");
    expect(quote).not.toHaveProperty("offers");
    expect(JSON.stringify(quote)).not.toMatch(/"price"/);
  });
});

describe("presets: a starting catalogue per line of business", () => {
  const names = readdirSync("content/presets").filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  const read = (name: string) => JSON.parse(readFileSync(`content/presets/${name}.json`, "utf8"));
  const THEME = ["background", "surface", "ink", "muted", "line", "action", "onAction", "highlight"];

  it("has one for every line of business the README promises", () => {
    expect(names).toEqual(expect.arrayContaining(["mixto", "moda", "gastronomia", "tecnologia", "almacen", "servicios", "digital", "a-medida"]));
  });

  it.each(names)("%s is complete, valid and marked as an example", (name) => {
    const preset = read(name);
    const { categories, products } = parseCatalog(preset);
    expect(products.length).toBeGreaterThanOrEqual(5);
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
    expect(Object.keys(preset.palette).sort()).toEqual([...THEME].sort());
    for (const colour of Object.values(preset.palette)) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(preset._note).toContain("EXAMPLE");
    for (const key of ["heroEyebrow", "heroTitle", "heroText", "heroCta"]) expect(preset.home[key]).toMatchObject({ es: expect.any(String), en: expect.any(String) });
    expect(preset.home.benefits.length).toBeGreaterThanOrEqual(3);
    expect(preset.home.faq.length).toBeGreaterThanOrEqual(3);
    for (const p of products) {
      expect(categories.some((c) => c.slug === p.category)).toBe(true);
      expect(p.description).toMatch(/EJEMPLO|EXAMPLE/);
      expect(p.images.length).toBeGreaterThanOrEqual(1);
      // Placeholders drawn by a script: no photo with rights attached.
      for (const image of p.images) expect(readFileSync(join("public", image.src), "utf8")).toContain("<svg");
      if (p.type === "quote") expect(p.price).toBe(0);
      else expect(p.price).toBeGreaterThan(0);
      if (p.type === "service") expect(p.service).toMatchObject({ durationMinutes: expect.any(Number), capacity: expect.any(Number) });
      if (p.type === "digital") expect(existsSync(join("content/downloads", p.digital!.file!))).toBe(true);
      expect(validQuantity(p, p.minQuantity, commerce.maxQuantityPerLine)).toBe(true);
    }
  });

  it("the demo is the mixed preset: every type and several lines of business", () => {
    const mixto = read("mixto");
    const demo = JSON.parse(readFileSync("content/products.json", "utf8"));
    expect(demo.products).toEqual(mixto.products);
    expect(JSON.parse(readFileSync("content/site.json", "utf8"))).toMatchObject({ preset: "mixto", home: mixto.home });
    expect(new Set(mixto.products.map((p: Product) => p.type))).toEqual(new Set(["physical", "digital", "service", "quote"]));
    expect(mixto.categories.length).toBeGreaterThanOrEqual(6);
    // The first screen mixes lines of business: the featured products come from many categories.
    const featured = mixto.products.filter((p: Product) => p.featured);
    expect(new Set(featured.map((p: Product) => p.category)).size).toBeGreaterThanOrEqual(6);
  });

  it("`npm run preset` lists them, and applying one rewrites the catalogue, the home and the palette", () => {
    const root = mkdtempSync(join(tmpdir(), "preset-"));
    try {
      for (const dir of ["scripts", "content/presets", "config", "db"]) mkdirSync(join(root, dir), { recursive: true });
      for (const file of ["scripts/preset.mjs", "scripts/generate-seed.mjs", "config/brand.ts", "content/products.json", "content/site.json"]) cpSync(file, join(root, file));
      cpSync("content/presets", join(root, "content/presets"), { recursive: true });
      const run = (...args: string[]) => execFileSync(process.execPath, [join(root, "scripts/preset.mjs"), ...args], { encoding: "utf8", env: { ...process.env, DATA_DIR: ".data" } });

      const list = run();
      for (const name of names) expect(list).toContain(name);
      expect(() => run("nope")).toThrow();

      expect(run("servicios")).toContain('Preset "servicios" applied');
      const applied = JSON.parse(readFileSync(join(root, "content/products.json"), "utf8"));
      expect(applied.products).toEqual(read("servicios").products);
      expect(applied._note).toContain("EXAMPLE");
      expect(JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"))).toMatchObject({ preset: "servicios", home: read("servicios").home });
      const brand = readFileSync(join(root, "config/brand.ts"), "utf8");
      for (const [key, value] of Object.entries(read("servicios").palette)) expect(brand).toMatch(new RegExp(`${key}: "${value}"`));
      // Nothing but the eight colours changed in the brand file.
      const strip = (s: string) => s.replace(/#[0-9a-fA-F]{6}/g, "#");
      expect(strip(brand)).toBe(strip(readFileSync("config/brand.ts", "utf8")));
      expect(readFileSync(join(root, "db/seed.sql"), "utf8")).toContain("'corte-de-pelo'");

      // --keep-theme leaves the colours alone.
      run("moda", "--keep-theme");
      expect(readFileSync(join(root, "config/brand.ts"), "utf8")).toBe(brand);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
