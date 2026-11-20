import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ordersVersion, reportPurchaseOnce } from "@/lib/admin/orders";
import { customersFromOrders, salesSummary } from "@/lib/admin/reports";
import { generateVariants, slugify } from "@/lib/admin/products";
import { demoOrders } from "@/lib/data/demo-orders";
import { AdminError, type AdminOrder } from "@/lib/data/types";
import { allowedMoves, canMove, neighbour, ORDER_FLOW, ORDER_STATUSES } from "@/lib/orders/status";
import { sniffImage, uploadName } from "@/lib/storage";
import { hoodie, product, request, tee } from "./helpers";

describe("order status transitions", () => {
  it("allows the normal path, one step at a time", () => {
    // `quote` (an enquiry) is the first column, but nobody moves it by hand: see the quote tests.
    const flow = ORDER_FLOW.filter((s) => s !== "quote");
    expect(ORDER_FLOW[0]).toBe("quote");
    for (let i = 0; i < flow.length - 1; i++) expect(canMove(flow[i]!, flow[i + 1]!)).toBe(true);
  });
  it("allows stepping back before delivery and cancelling before shipping", () => {
    expect(canMove("preparing", "paid")).toBe(true);
    expect(canMove("shipped", "preparing")).toBe(true);
    expect(canMove("delivered", "shipped")).toBe(true);
    expect(canMove("new", "cancelled")).toBe(true);
    expect(canMove("paid", "cancelled")).toBe(true);
    expect(canMove("preparing", "cancelled")).toBe(true);
  });
  it("refuses the moves that make no sense", () => {
    expect(canMove("new", "preparing")).toBe(false); // must be paid first
    expect(canMove("new", "shipped")).toBe(false);
    expect(canMove("new", "delivered")).toBe(false);
    expect(canMove("paid", "new")).toBe(false); // the purchase was already reported
    // An enquiry becomes an order only when the CUSTOMER accepts the quote; the owner can only cancel it.
    expect(allowedMoves("quote")).toEqual(["cancelled"]);
    expect(canMove("new", "quote")).toBe(false);
    // An order with nothing to ship (a service, a download) may be closed straight after the payment.
    expect(canMove("paid", "delivered")).toBe(true);
    expect(canMove("shipped", "cancelled")).toBe(false);
    expect(canMove("delivered", "cancelled")).toBe(false);
    expect(canMove("delivered", "new")).toBe(false);
    for (const to of ORDER_STATUSES) {
      expect(canMove("cancelled", to)).toBe(false); // final
      expect(canMove(to, to)).toBe(false);
    }
    expect(allowedMoves("cancelled")).toEqual([]);
  });
  it("finds the keyboard neighbour", () => {
    expect(neighbour("new", 1)).toBe("paid");
    expect(neighbour("new", -1)).toBeNull();
    expect(neighbour("paid", 1)).toBe("preparing");
    expect(neighbour("paid", -1)).toBeNull();
    expect(neighbour("delivered", 1)).toBeNull();
    expect(neighbour("delivered", -1)).toBe("shipped");
    expect(neighbour("cancelled", 1)).toBeNull();
  });
});

const catalog = [
  product(), tee(), hoodie(),
  product({ id: "haircut", slug: "haircut", name: "Haircut", type: "service", stock: null, service: { durationMinutes: 30, capacity: 1 } }),
  product({ id: "guide", slug: "guide", name: "Guide", type: "digital", stock: null, digital: { name: "guide.pdf" } }),
  product({ id: "custom", slug: "custom", name: "Custom work", type: "quote", stock: null, price: 0 }),
];
const now = Date.parse("2026-03-10T15:00:00.000Z");

describe("the purchase is sent only once", () => {
  const order = { ...demoOrders(catalog, now)[3]!, attribution: { consent: "granted", fbp: "fb.1.2.3" } } satisfies AdminOrder;

  it("sends it the first time, with the order id as event id", async () => {
    const claimed = new Set<string>();
    const send = vi.fn(async (_event: unknown) => undefined);
    const deps = { claim: async (id: string) => !claimed.has(id) && Boolean(claimed.add(id)), send, siteUrl: "https://example.com" };
    expect(await reportPurchaseOnce(order, deps)).toBe(true);
    expect(await reportPurchaseOnce(order, deps)).toBe(false);
    expect(await reportPurchaseOnce(order, deps)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ name: "purchase", eventId: order.id, value: order.total, currency: order.currency });
  });

  it("does nothing when the order already says it was sent", async () => {
    const send = vi.fn(async (_event: unknown) => undefined);
    const claim = vi.fn(async () => true);
    expect(await reportPurchaseOnce({ ...order, purchaseSentAt: "2026-03-10T15:00:00.000Z" }, { claim, send, siteUrl: "" })).toBe(false);
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("claims but does not send without the buyer's consent", async () => {
    const send = vi.fn(async (_event: unknown) => undefined);
    expect(await reportPurchaseOnce({ ...order, attribution: {} }, { claim: async () => true, send, siteUrl: "" })).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("json adapter with a local data folder", () => {
  let dir: string;
  let adapter: typeof import("@/lib/data/json").jsonAdapter;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "store-"));
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

  const KEY = "b".repeat(64);
  let id = "";

  it("stores an order, with the price of the catalogue, once per idempotency key", async () => {
    const products = await adapter.listProducts();
    const simple = products.find((p) => p.options.length === 0 && (p.stock ?? 0) > 2)!;
    // The adapter hands out its live objects: keep the numbers, not the reference.
    const { stock: stockBefore, price } = simple;
    const lines = [{ productId: simple.id, quantity: 2 }];
    const first = await adapter.createOrder(request({ idempotencyKey: KEY, lines }), { price: 0, freeFrom: null });
    const again = await adapter.createOrder(request({ idempotencyKey: KEY, lines }), { price: 0, freeFrom: null });
    id = first.id;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ status: "new", paidAt: null, total: price * 2 });
    expect(await adapter.listOrders()).toHaveLength(1);
    // The stock went down once, not twice.
    const after = (await adapter.listAllProducts()).find((p) => p.id === simple.id)!;
    expect(after.stock).toBe(stockBefore! - 2);
  });

  it("the same key with a DIFFERENT cart is a different order, never the same id with another total", async () => {
    const simple = (await adapter.listProducts()).find((p) => p.options.length === 0 && (p.stock ?? 0) > 5)!;
    const first = await adapter.getOrder(id);
    const other = await adapter.createOrder(request({ idempotencyKey: KEY, lines: [{ productId: simple.id, quantity: 1 }] }), { price: 0, freeFrom: null });
    expect(other.id).not.toBe(id);
    expect(other.total).not.toBe(first!.total);
    expect((await adapter.getOrder(id))?.total).toBe(first!.total);
    expect(await adapter.listOrders()).toHaveLength(2);
  });

  it("the public order carries no personal data; the admin one does", async () => {
    expect(await adapter.getOrder(id)).not.toHaveProperty("customer");
    expect((await adapter.getAdminOrder(id))?.customer.email).toBe("ana@example.com");
  });

  it("writes every move to the history and refuses a stale one", async () => {
    const paid = await adapter.setOrderStatus(id, "new", "paid", "owner@example.com");
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.history.map((e) => e.type)).toEqual(["created", "status"]);
    expect(paid.history[1]).toMatchObject({ from: "new", to: "paid", actor: "owner@example.com" });
    // Someone else still sees it in "new" and tries to move it.
    await expect(adapter.setOrderStatus(id, "new", "cancelled", "other@example.com", "x")).rejects.toMatchObject({ code: "conflict" });
    await expect(adapter.setOrderStatus("P-NOPE", "new", "paid", "x")).rejects.toBeInstanceOf(AdminError);
  });

  it("claims the purchase event exactly once", async () => {
    expect(await adapter.claimPurchaseEvent(id)).toBe(true);
    expect(await adapter.claimPurchaseEvent(id)).toBe(false);
    expect((await adapter.getAdminOrder(id))?.purchaseSentAt).not.toBeNull();
  });

  it("keeps notes and tracking, and returns the stock when cancelling", async () => {
    await adapter.addOrderNote(id, "Call before delivery", "owner@example.com");
    const tracked = await adapter.setOrderTracking(id, " EX-123 ", "owner@example.com");
    expect(tracked.tracking).toBe("EX-123");
    const current = await adapter.getAdminOrder(id);
    const stockOf = async (productId: string) => (await adapter.listAllProducts()).find((p) => p.id === productId)!.stock!;
    const before = await stockOf(current!.lines[0]!.productId);
    const cancelled = await adapter.setOrderStatus(id, "paid", "cancelled", "owner@example.com", "Customer asked");
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Customer asked" });
    const line = cancelled.lines[0]!;
    expect(await stockOf(line.productId)).toBe(before + line.quantity);
    expect(cancelled.history.filter((e) => e.type === "note")).toHaveLength(1);
  });

  it("cancelling returns only the stock the order really took", async () => {
    const catalog = await adapter.listAllProducts();
    // A made-to-order product (no stock number): the order takes nothing from the shelf…
    const made = catalog.find((p) => p.type === "physical" && p.unit === "u" && p.options.length === 0 && p.stock === null) ?? (await adapter.saveProduct({ ...product({ id: "to-order", slug: "to-order", name: "To order", category: catalog[0]!.category, stock: null }) }));
    const order = await adapter.createOrder(request({ idempotencyKey: "d".repeat(64), lines: [{ productId: made.id, quantity: 2 }] }), { price: 0, freeFrom: null });
    // …the owner then starts counting stock for it…
    await adapter.setStock(made.id, null, 10);
    // …and cancelling the old order must NOT add 2 units that were never taken.
    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "x");
    expect((await adapter.listAllProducts()).find((p) => p.id === made.id)?.stock).toBe(10);
    expect(await adapter.getOrder(order.id)).not.toHaveProperty("lines.0.stockTaken");
  });

  it("expires unpaid orders after the deadline and releases their stock", async () => {
    // A product no earlier test bought: every unpaid order expires below, and each returns its own stock.
    const simple = (await adapter.listProducts()).find((p) => p.id === "vela-aromatica-de-soja")!;
    const before = simple.stock!;
    const order = await adapter.createOrder(request({ idempotencyKey: "f".repeat(64), lines: [{ productId: simple.id, quantity: 3 }] }), { price: 0, freeFrom: null });
    const stockNow = async () => (await adapter.listAllProducts()).find((p) => p.id === simple.id)!.stock;
    expect(await stockNow()).toBe(before - 3);
    // Not old enough yet.
    expect(await adapter.expireOrders(48, "Expired")).toBe(0);
    // 49 hours later (the clock is moved, not the data).
    vi.useFakeTimers({ now: Date.now() + 49 * 3_600_000, toFake: ["Date"] });
    try {
      expect(await adapter.expireOrders(48, "Expired")).toBeGreaterThanOrEqual(1);
      expect(await adapter.expireOrders(48, "Expired")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    const expired = await adapter.getAdminOrder(order.id);
    expect(expired).toMatchObject({ status: "cancelled", cancelReason: "Expired" });
    expect(expired?.history.at(-1)).toMatchObject({ type: "status", from: "new", to: "cancelled", actor: "system" });
    expect(await stockNow()).toBe(before);
    // Paid orders never expire.
    expect((await adapter.listOrders()).filter((o) => o.paidAt && o.cancelReason === "Expired")).toEqual([]);
  });

  it("a payment for a cancelled order is recorded, not credited", async () => {
    const order = (await adapter.listOrders()).find((o) => o.cancelReason === "Expired")!;
    const pay = () => adapter.recordPayment({ provider: "stripe", paymentId: "late-1", orderId: order.id, amount: order.total, currency: order.currency, status: "approved" });
    expect(await pay()).toMatchObject({ firstTime: true, orderStatus: "cancelled" });
    expect(await pay()).toMatchObject({ firstTime: false, orderStatus: "cancelled" });
    const after = await adapter.getAdminOrder(order.id);
    expect(after).toMatchObject({ status: "cancelled", paidAt: null });
    expect(after?.history.filter((e) => e.type === "payment" && e.from === "cancelled")).toHaveLength(1);
  });

  it("creates a product, pauses it, and edits stock inline", async () => {
    const category = (await adapter.listCategories())[0]!.slug;
    const saved = await adapter.saveProduct({ ...product({ id: "new-thing", slug: "new-thing", name: "New thing", category, stock: 4 }) });
    expect((await adapter.listProducts()).some((p) => p.id === "new-thing")).toBe(true);
    await adapter.setStock("new-thing", null, 9);
    expect((await adapter.listAllProducts()).find((p) => p.id === "new-thing")?.stock).toBe(9);
    await adapter.saveProduct({ ...saved, active: false });
    expect((await adapter.listProducts()).some((p) => p.id === "new-thing")).toBe(false);
    expect((await adapter.listAllProducts()).some((p) => p.id === "new-thing")).toBe(true);
    await expect(adapter.saveProduct({ ...saved, id: "other", slug: "new-thing" })).rejects.toMatchObject({ code: "slug_taken" });
    await expect(adapter.saveProduct({ ...saved, category: "nope" })).rejects.toMatchObject({ code: "category" });
  });

  it("is read-only in production: nothing is stored and the panel shows example orders", async () => {
    process.env.JSON_READ_ONLY = "1";
    try {
      expect(adapter.writable).toBe(false);
      expect(adapter.storesOrders).toBe(false);
      await expect(adapter.setOrderStatus(id, "cancelled", "new", "x")).rejects.toThrow("READ_ONLY");
      await expect(adapter.saveProduct(product())).rejects.toThrow("READ_ONLY");
      const demo = await adapter.listOrders();
      expect(new Set(demo.map((o) => o.status))).toEqual(new Set(ORDER_STATUSES));
      const order = await adapter.createOrder(request({ idempotencyKey: "c".repeat(64), lines: [{ productId: (await adapter.listProducts()).find((p) => p.options.length === 0 && (p.stock ?? 0) > 0)!.id, quantity: 1 }] }), { price: 0, freeFrom: null });
      expect(order.status).toBe("new");
      expect(await adapter.getOrder(order.id)).toBeNull();
    } finally {
      delete process.env.JSON_READ_ONLY;
    }
  });
});

describe("reports and helpers", () => {
  const orders = demoOrders(catalog, now);

  it("seeds example orders in every status, every person invented", () => {
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(ORDER_STATUSES));
    for (const o of orders) {
      expect(o.customer.email).toMatch(/@example\.com$/);
      expect(o.total).toBe(o.subtotal + o.shipping.price);
      // Shipping only where something is shipped.
      if (!o.lines.some((l) => l.type === "physical")) expect(o.shipping).toEqual({ methodId: "none", price: 0 });
      expect(Date.parse(o.createdAt)).toBeLessThanOrEqual(now);
      expect(o.history[0]).toMatchObject({ type: "created" });
      expect(o.history.at(-1)?.to ?? o.history.findLast((e) => e.to)?.to).toBeDefined();
    }
  });

  it("summarises sales: paid orders count, cancelled ones never do", () => {
    const summary = salesSummary(orders, now);
    const paid30 = orders.filter((o) => o.paidAt && o.status !== "cancelled" && now - Date.parse(o.createdAt) < 29 * 86_400_000);
    expect(summary.month.sales).toBe(paid30.reduce((s, o) => s + o.total, 0));
    expect(summary.month.pendingPayment).toBe(orders.filter((o) => o.status === "new").length);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily.reduce((s, d) => s + d.sales, 0)).toBe(summary.month.sales);
    expect(summary.topProducts.length).toBeGreaterThan(0);
    expect(summary.today.sales).toBeLessThanOrEqual(summary.week.sales);
    expect(summary.week.sales).toBeLessThanOrEqual(summary.month.sales);
  });

  it("builds the customer list from the orders", () => {
    const customers = customersFromOrders(orders);
    expect(customers.length).toBe(new Set(orders.map((o) => o.customer.email)).size);
    const ana = customers.find((c) => c.email === "ana@example.com")!;
    expect(ana.orders).toBe(orders.filter((o) => o.customer.email === "ana@example.com" && o.status !== "cancelled").length);
  });

  it("changes the list fingerprint when something changes", () => {
    const a = ordersVersion(orders);
    expect(ordersVersion(orders)).toBe(a);
    expect(ordersVersion(orders.slice(1))).not.toBe(a);
    expect(ordersVersion(orders.map((o, i) => (i === 0 ? { ...o, status: "cancelled" as const } : o)))).not.toBe(a);
  });

  it("generates variants keeping the stock of the existing ones", () => {
    const t = tee();
    const variants = generateVariants("tee", t.options, t.variants);
    expect(variants).toHaveLength(4);
    expect(variants.find((v) => v.id === "tee-s-black")?.stock).toBe(3);
    expect(variants.find((v) => v.options.size === "s" && v.options.color === "white")).toMatchObject({ id: "tee-s-white", stock: 0 });
    expect(slugify("  Taza de Cerámica Ñandú 500 ml ")).toBe("taza-de-ceramica-nandu-500-ml");
  });

  it("names uploads safely and checks the real type of the bytes", () => {
    expect(uploadName("../../Etc/Passwd", "image/webp", "abc123")).toBe("etc-passwd-abc123.webp");
    expect(uploadName("photo", "text/html", "abc123")).toBeNull();
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);
    expect(sniffImage(webp)).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
