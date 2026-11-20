// DATA ADAPTER: json (the default — demo mode, no keys, no database).
//
// The catalogue is content/products.json. What happens with WRITES depends on where it runs:
//
//   · Local (`next dev`, or `next start` without APP_ENV=production): the admin panel works for
//     real. Orders, stock and product edits are saved to files under DATA_DIR (`.data/` by
//     default, never committed). `npm run data:export` copies the edited catalogue back to
//     content/products.json.
//   · Production: READ-ONLY. Hosting file systems are often temporary or read-only, so nothing is
//     stored: the order travels to the buyer as a signed receipt (lib/orders/receipt.ts) and
//     reaches the owner by WhatsApp or e-mail, and the admin panel shows example orders with the
//     notice "demo mode: changes are not saved; connect a database".
//
// Good enough to try the store and to sell by message. Switch to a database adapter when you
// need stock that decreases, an order list or online payments you can audit.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import raw from "@/content/products.json";
import { tr } from "@/i18n";
import { env } from "@/lib/env";
import { lineTotal } from "@/lib/format";
import { buildOrder, buildQuote, priceOrder, quoteTotals } from "@/lib/orders/pricing";
import { roundQuantity } from "./availability";
import { orderIdFromKey } from "@/lib/orders/receipt";
import { demoOrders } from "./demo-orders";
import {
  AdminError, ReadOnlyError,
  OrderError,
  type AdminOrder, type Booking, type Category, type DataAdapter, type Order, type OrderEvent, type OrderRequest, type Product,
  type ProductType, type ServiceSettings,
} from "./types";

type Text = string | Record<string, string>;
interface RawProduct {
  id: string; slug: string; name: Text; description: Text; category: string; price: number;
  compareAtPrice?: number | null; featured?: boolean; active?: boolean; minQuantity?: number; stock?: number | null;
  attributes?: Record<string, string>; createdAt?: string;
  type?: ProductType; unit?: string; step?: number; maxQuantity?: number | null;
  service?: ServiceSettings | null; digital?: { name: string; file?: string } | null;
  options?: { id: string; name: Text; values: { id: string; label: Text; swatch?: string }[] }[];
  variants?: { id: string; options: Record<string, string>; stock: number | null; price?: number | null }[];
  images: { src: string; alt: Text; width: number; height: number; option?: Record<string, string> }[];
}

export interface Catalog {
  categories: Category[];
  products: Product[];
}

export function parseCatalog(data: { categories: { slug: string; name: Text; description?: Text }[]; products: RawProduct[] }): Catalog {
  const categories: Category[] = data.categories.map((c) => ({ slug: c.slug, name: tr(c.name), description: tr(c.description) }));
  const products: Product[] = data.products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: tr(p.name),
    description: tr(p.description),
    category: p.category,
    price: p.price,
    compareAtPrice: p.compareAtPrice ?? null,
    images: p.images.map((i) => ({ src: i.src, alt: tr(i.alt), width: i.width, height: i.height, ...(i.option ? { option: i.option } : {}) })),
    options: (p.options ?? []).map((o) => ({
      id: o.id,
      name: tr(o.name),
      values: o.values.map((v) => ({ id: v.id, label: tr(v.label), ...(v.swatch ? { swatch: v.swatch } : {}) })),
    })),
    variants: p.variants ?? [],
    stock: p.stock ?? null,
    featured: p.featured ?? false,
    active: p.active ?? true,
    minQuantity: p.minQuantity ?? 1,
    attributes: p.attributes ?? {},
    type: p.type ?? "physical",
    unit: p.unit ?? "u",
    step: p.step ?? 1,
    maxQuantity: p.maxQuantity ?? null,
    service: p.type === "service" ? (p.service ?? null) : null,
    digital: p.type === "digital" ? (p.digital ?? null) : null,
    createdAt: p.createdAt ?? "2026-01-01T00:00:00.000Z",
  }));
  return { categories, products };
}

type StoredOrder = AdminOrder & { idempotencyKey?: string; acceptedAt?: string | null };

/** Catalogues saved by 0.1.0 have no product types: fill in the defaults. */
function upgradeCatalog(c: Catalog): Catalog {
  for (const p of c.products) {
    p.type ??= "physical";
    p.unit ??= "u";
    p.step ??= 1;
    p.maxQuantity ??= null;
    p.service ??= null;
    p.digital ??= null;
  }
  return c;
}

function upgradeOrders(orders: StoredOrder[]): StoredOrder[] {
  for (const o of orders) {
    o.quote ??= null;
    for (const l of o.lines) {
      l.type ??= "physical";
      l.unit ??= "u";
      l.slot ??= null;
    }
  }
  return orders;
}

/** The storefront never receives the storage key of a digital file. */
function forStore(p: Product): Product {
  return p.digital ? { ...p, digital: { name: p.digital.name } } : p;
}

/** Seats held per `<productId>|<slot start>` by every order that is not cancelled. */
function seatsHeld(orders: StoredOrder[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const l of o.lines) if (l.slot) held.set(`${l.productId}|${l.slot.start}`, (held.get(`${l.productId}|${l.slot.start}`) ?? 0) + l.quantity);
  }
  return held;
}

// ONE state per server process. It hangs from `globalThis` because the bundler may load this
// module more than once (pages and route handlers live in different layers).
interface State {
  dir: string;
  catalog?: Catalog;
  orders?: StoredOrder[];
  queue: Promise<unknown>;
  seenPayments: Set<string>;
  claimed: Set<string>;
}
const globalState = globalThis as unknown as { __jsonStore?: State };

function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || ".data");
}

function state(): State {
  const dir = dataDir();
  if (!globalState.__jsonStore || globalState.__jsonStore.dir !== dir) {
    globalState.__jsonStore = { dir, queue: Promise.resolve(), seenPayments: new Set(), claimed: new Set() };
  }
  return globalState.__jsonStore;
}

/** Files are only written outside production and outside read-only hosting. */
export function jsonWritable(): boolean {
  return !env().isProduction && !process.env.VERCEL && process.env.JSON_READ_ONLY !== "1";
}

async function readFile<T>(name: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dataDir(), name), "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeFile(name: string, value: unknown): Promise<void> {
  const file = path.join(/* turbopackIgnore: true */ dataDir(), name);
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(/* turbopackIgnore: true */ file), { recursive: true });
  // Write aside and rename: a crash in the middle never leaves half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value, null, 2));
  await fs.rename(/* turbopackIgnore: true */ tmp, file);
}

/** Runs writers one after the other: two requests never interleave on the same file. */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const s = state();
  const run = s.queue.then(work, work);
  s.queue = run.catch(() => undefined);
  return run;
}

async function loadCatalog(): Promise<Catalog> {
  const s = state();
  if (!s.catalog) {
    const saved = jsonWritable() ? await readFile<Catalog>("catalog.json") : undefined;
    s.catalog = saved ? upgradeCatalog(saved) : parseCatalog(raw as unknown as Parameters<typeof parseCatalog>[0]);
  }
  return s.catalog;
}

async function loadOrders(): Promise<StoredOrder[]> {
  const s = state();
  if (!jsonWritable()) return demoOrders((await loadCatalog()).products, Date.now());
  if (!s.orders) {
    const saved = await readFile<StoredOrder[]>("orders.json");
    if (saved) {
      s.orders = upgradeOrders(saved);
    } else {
      // First run: example orders in every status, so the kanban is not an empty screen.
      s.orders = process.env.DEMO_ORDERS === "false" ? [] : demoOrders((await loadCatalog()).products, Date.now());
      await writeFile("orders.json", s.orders);
    }
  }
  return s.orders;
}

const saveOrders = () => writeFile("orders.json", state().orders ?? []);
const saveCatalog = () => writeFile("catalog.json", state().catalog);

function publicOrder(o: StoredOrder): Order {
  const { customer: _c, attribution: _a, history: _h, cancelReason: _r, purchaseSentAt: _p, idempotencyKey: _k, acceptedAt: _t, ...order } = o;
  return { ...order, lines: order.lines.map(({ stockTaken: _s, ...line }) => line) };
}

function event(type: OrderEvent["type"], actor: string, extra: Partial<OrderEvent> = {}): OrderEvent {
  return { at: new Date().toISOString(), type, from: null, to: null, actor, text: "", ...extra };
}

function assertWritable(): void {
  if (!jsonWritable()) throw new ReadOnlyError();
}

/**
 * Takes (`sign` = -1) the units of an order's lines from the stock, or returns them (`sign` = 1).
 * Each line remembers whether it really took stock: returning gives back ONLY those units, once.
 */
function moveStock(catalog: Catalog, lines: Order["lines"], sign: 1 | -1): void {
  for (const line of lines) {
    if (sign === 1 && !line.stockTaken) continue;
    const product = catalog.products.find((p) => p.id === line.productId);
    const variant = line.variantId ? product?.variants.find((v) => v.id === line.variantId) : undefined;
    const target = variant ?? (product && product.options.length === 0 ? product : undefined);
    if (target && target.stock !== null) target.stock = Math.max(0, roundQuantity(target.stock + sign * line.quantity));
    line.stockTaken = sign === -1 && Boolean(target) && target!.stock !== null;
  }
}

/**
 * The idempotency key AS THE SERVER SEES IT: the key the browser sent plus a digest of what is
 * being bought. An honest retry sends the same of both. The same key with a DIFFERENT cart is a
 * different order — it can never come back with the id of the first one and another total.
 */
function contentKey(request: OrderRequest): string {
  const content = JSON.stringify([request.lines, request.shippingMethodId, request.paymentProvider, request.paymentMethod, request.customer.email]);
  return `${request.idempotencyKey}.${createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
}

async function mutateOrder(id: string, change: (order: StoredOrder) => void | Promise<void>): Promise<AdminOrder> {
  assertWritable();
  return exclusive(async () => {
    const order = (await loadOrders()).find((o) => o.id === id);
    if (!order) throw new AdminError("not_found");
    await change(order);
    await saveOrders();
    return order;
  });
}

export const jsonAdapter: DataAdapter = {
  id: "json",
  get storesOrders() {
    return jsonWritable();
  },
  get writable() {
    return jsonWritable();
  },

  async listProducts() {
    return (await loadCatalog()).products.filter((p) => p.active).map(forStore);
  },
  async listCategories() {
    return (await loadCatalog()).categories;
  },

  async createOrder(request, shipping) {
    // The id comes from the idempotency key: the same attempt always names the same order.
    const key = contentKey(request);
    const id = orderIdFromKey(key, env().orderSecret);
    if (!jsonWritable()) {
      const priced = priceOrder(request, (await this.listProducts()), shipping);
      return buildOrder(id, request, priced, new Date().toISOString());
    }
    return exclusive(async () => {
      const orders = await loadOrders();
      const existing = orders.find((o) => o.idempotencyKey === key);
      if (existing) return publicOrder(existing);
      const catalog = await loadCatalog();
      const priced = priceOrder(request, catalog.products.filter((p) => p.active), shipping, { taken: seatsHeld(orders) });
      const order = buildOrder(id, request, priced, new Date().toISOString());
      const stored = { ...order, lines: order.lines.map((l) => ({ ...l })) };
      moveStock(catalog, stored.lines, -1);
      orders.unshift({
        ...stored,
        customer: request.customer,
        attribution: request.attribution ?? {},
        history: [event("created", "store", { to: "new" })],
        cancelReason: null,
        purchaseSentAt: null,
        idempotencyKey: key,
      });
      await saveOrders();
      await saveCatalog();
      return order;
    });
  },

  async createQuote(request) {
    const key = `${request.idempotencyKey}.${createHash("sha256").update(JSON.stringify([request.productId, request.quantity, request.detail, request.customer.email])).digest("hex").slice(0, 32)}`;
    const id = orderIdFromKey(key, env().orderSecret);
    if (!jsonWritable()) return buildQuote(id, request, await this.listProducts(), new Date().toISOString());
    return exclusive(async () => {
      const orders = await loadOrders();
      const existing = orders.find((o) => o.idempotencyKey === key);
      if (existing) return publicOrder(existing);
      const order = buildQuote(id, request, (await loadCatalog()).products.filter((p) => p.active), new Date().toISOString());
      orders.unshift({
        ...order,
        lines: order.lines.map((l) => ({ ...l })),
        customer: request.customer,
        attribution: request.attribution ?? {},
        history: [event("created", "store", { to: "quote" })],
        cancelReason: null,
        purchaseSentAt: null,
        idempotencyKey: key,
      });
      await saveOrders();
      return order;
    });
  },

  async acceptQuote(id, expectedTotal, paymentProvider, paymentMethod) {
    if (!jsonWritable()) throw new OrderError("not_found", id);
    return exclusive(async () => {
      const order = (await loadOrders()).find((o) => o.id === id);
      if (!order || !order.quote || order.status === "cancelled") throw new OrderError("not_found", id);
      // Accepting twice is the same as accepting once.
      if (order.status !== "quote") return publicOrder(order);
      if (!order.quote.sentAt) throw new OrderError("quote_not_sent", id);
      if (!Number.isFinite(expectedTotal) || Math.abs(order.total - expectedTotal) >= 0.005) throw new OrderError("quote_changed", id);
      order.status = "new";
      order.acceptedAt = new Date().toISOString();
      order.paymentProvider = paymentProvider;
      order.paymentMethod = paymentMethod;
      order.history.push(event("status", "store", { from: "quote", to: "new" }));
      await saveOrders();
      return publicOrder(order);
    });
  },

  async listBookings(from, to) {
    const out: Booking[] = [];
    for (const o of await loadOrders()) {
      if (o.status === "cancelled") continue;
      for (const l of o.lines) {
        if (!l.slot || l.slot.start < from || l.slot.start >= to) continue;
        out.push({
          orderId: o.id, productId: l.productId, name: l.name, variantLabel: l.variantLabel, start: l.slot.start, end: l.slot.end,
          seats: l.quantity, orderStatus: o.status, paid: o.paidAt !== null, customerName: o.customer.name, customerPhone: o.customer.phone,
        });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  },

  async getDigitalFile(productId) {
    const digital = (await loadCatalog()).products.find((p) => p.id === productId && p.type === "digital")?.digital;
    return digital?.file ? { name: digital.name, file: digital.file } : null;
  },

  async getOrder(id) {
    if (!jsonWritable()) return null;
    const order = (await loadOrders()).find((o) => o.id === id);
    return order ? publicOrder(order) : null;
  },

  async recordPayment(payment) {
    const s = state();
    const key = `${payment.provider}:${payment.paymentId}`;
    if (!jsonWritable()) {
      // Without a database this is best effort only (another server instance would not know):
      // one of the reasons to move to a database adapter before charging online.
      if (payment.status !== "approved") return { firstTime: false, amountMatches: null };
      const firstTime = !s.seenPayments.has(key);
      s.seenPayments.add(key);
      return { firstTime, amountMatches: null };
    }
    return exclusive(async () => {
      const order = (await loadOrders()).find((o) => o.id === payment.orderId);
      if (!order) return { firstTime: false, amountMatches: null };
      const amountMatches =
        Math.abs(order.total - payment.amount) < 0.005 && order.currency.toUpperCase() === payment.currency.toUpperCase();
      const seen = order.history.some((e) => e.type === "payment" && e.actor === payment.provider && e.text === payment.paymentId);
      if (seen || payment.status !== "approved") return { firstTime: false, amountMatches, orderStatus: order.status };
      if (order.status === "cancelled") {
        // Money for a cancelled order: never credited, written down so a person reviews it.
        order.history.push(event("payment", payment.provider, { from: "cancelled", text: payment.paymentId }));
        await saveOrders();
        return { firstTime: true, amountMatches, orderStatus: "cancelled" };
      }
      if (amountMatches && order.status === "new") {
        order.status = "paid";
        order.paidAt = new Date().toISOString();
        order.history.push(event("payment", payment.provider, { from: "new", to: "paid", text: payment.paymentId }));
        await saveOrders();
      }
      return { firstTime: true, amountMatches, orderStatus: order.status };
    });
  },

  async listAllProducts() {
    return (await loadCatalog()).products;
  },

  async saveProduct(input) {
    assertWritable();
    return exclusive(async () => {
      const catalog = await loadCatalog();
      if (!input.id || !input.slug || !input.name) throw new AdminError("invalid");
      if (catalog.products.some((p) => p.slug === input.slug && p.id !== input.id)) throw new AdminError("slug_taken");
      if (!catalog.categories.some((c) => c.slug === input.category)) throw new AdminError("category");
      const i = catalog.products.findIndex((p) => p.id === input.id);
      const product: Product = { ...input, createdAt: catalog.products[i]?.createdAt ?? input.createdAt ?? new Date().toISOString() };
      if (i >= 0) catalog.products[i] = product;
      else catalog.products.unshift(product);
      await saveCatalog();
      return product;
    });
  },

  async setStock(productId, variantId, stock) {
    assertWritable();
    return exclusive(async () => {
      const product = (await loadCatalog()).products.find((p) => p.id === productId);
      const target = variantId ? product?.variants.find((v) => v.id === variantId) : product;
      if (!target) throw new AdminError("not_found");
      target.stock = stock;
      await saveCatalog();
    });
  },

  async listOrders() {
    const orders = await loadOrders();
    return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  },

  async getAdminOrder(id) {
    return (await loadOrders()).find((o) => o.id === id) ?? null;
  },

  async setOrderStatus(id, from, to, actor, reason = "") {
    return mutateOrder(id, async (order) => {
      if (order.status !== from) throw new AdminError("conflict", order.status);
      order.status = to;
      if (to === "paid") order.paidAt ??= new Date().toISOString();
      if (to === "cancelled") {
        order.cancelReason = reason.trim() || null;
        moveStock(await loadCatalog(), order.lines, 1);
        await saveCatalog();
      }
      order.history.push(event("status", actor, { from, to, text: reason }));
    });
  },

  async addOrderNote(id, text, actor) {
    return mutateOrder(id, (order) => {
      order.history.push(event("note", actor, { text }));
    });
  },

  async setQuote(id, answer, actor) {
    return mutateOrder(id, (order) => {
      if (order.status !== "quote") throw new AdminError("conflict", order.status);
      order.lines.forEach((l, i) => {
        l.unitPrice = Math.max(0, Math.round((answer.prices[i] ?? 0) * 100) / 100);
      });
      const totals = quoteTotals(order.lines, order.lines.map((l) => l.unitPrice), answer.shipping);
      order.subtotal = totals.subtotal;
      order.shipping = { methodId: order.shipping.methodId, price: totals.shipping };
      order.total = totals.total;
      // What the customer can accept is always what was last SENT.
      order.quote = { sentAt: null };
      order.history.push(event("quote", actor, { text: `priced:${totals.total}` }));
    });
  },

  async sendQuote(id, actor) {
    return mutateOrder(id, (order) => {
      if (order.status !== "quote") throw new AdminError("conflict", order.status);
      if (order.total <= 0 || order.lines.some((l) => lineTotal(l) <= 0)) throw new AdminError("quote_incomplete");
      order.quote = { sentAt: new Date().toISOString() };
      order.history.push(event("quote", actor, { text: `sent:${order.total}` }));
    });
  },

  async setOrderTracking(id, tracking, actor) {
    return mutateOrder(id, (order) => {
      order.tracking = tracking.trim() || null;
      order.history.push(event("tracking", actor, { text: tracking.trim() }));
    });
  },

  async claimPurchaseEvent(id) {
    if (!jsonWritable()) {
      const s = state();
      if (s.claimed.has(id)) return false;
      s.claimed.add(id);
      return true;
    }
    return exclusive(async () => {
      const order = (await loadOrders()).find((o) => o.id === id);
      if (!order || order.purchaseSentAt) return false;
      order.purchaseSentAt = new Date().toISOString();
      await saveOrders();
      return true;
    });
  },

  async expireOrders(hours, reason) {
    if (!jsonWritable() || hours <= 0) return 0;
    return exclusive(async () => {
      const cutoff = Date.now() - hours * 3_600_000;
      // A quote the customer accepted counts from the moment they accepted it.
      const stale = (await loadOrders()).filter((o) => o.status === "new" && o.paidAt === null && Date.parse(o.acceptedAt ?? o.createdAt) < cutoff);
      if (stale.length === 0) return 0;
      const catalog = await loadCatalog();
      for (const order of stale) {
        order.status = "cancelled";
        order.cancelReason = reason;
        moveStock(catalog, order.lines, 1);
        order.history.push(event("status", "system", { from: "new", to: "cancelled", text: reason }));
      }
      await saveOrders();
      await saveCatalog();
      return stale.length;
    });
  },
};

/** Test helper: forget what this process has in memory (the files stay). */
export function resetJsonStore(): void {
  globalState.__jsonStore = undefined;
}
