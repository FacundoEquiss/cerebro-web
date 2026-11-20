// The REAL SQL of db/schema.sql, run in an in-process PostgreSQL (PGlite): the same statements
// the `postgres` and `supabase` adapters execute.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The adapter module wires Next's data cache; outside Next it is a pass-through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => undefined }));

import { postgresGateway } from "@/lib/data/postgres";
import { sqlAdapter } from "@/lib/data/sql";
import type { DataAdapter } from "@/lib/data/types";
import { seedSql } from "../scripts/generate-seed.mjs";
import { request } from "./helpers";

const seedProducts = (seedSql().match(/insert into products /g) ?? []).length;
const seedCategories = (seedSql().match(/insert into categories /g) ?? []).length;
let db: PGlite;
let adapter: DataAdapter;
const terms = { price: 6500, freeFrom: 90000 };
const key = (c: string) => c.repeat(64);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("db/schema.sql", "utf8"));
  await db.exec(seedSql());
  // Running the schema twice must be safe.
  await db.exec(readFileSync("db/schema.sql", "utf8"));
  adapter = sqlAdapter("postgres", postgresGateway((sql, params) => db.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>));
});

const stock = async (table: "products" | "variants", id: string) =>
  // numeric columns come back as text ("12.000"): stock may be kilos.
  (([v]) => (v === null ? null : Number(v)))([((await db.query(`select stock from ${table} where id = $1`, [id])).rows[0] as { stock: string | null }).stock]);

describe("catalogue", () => {
  it("reads the demo catalogue through the public views", async () => {
    const products = await adapter.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(10);
    expect((await adapter.listCategories()).length).toBeGreaterThanOrEqual(3);
    const tee = products.find((p) => p.id === "camiseta-basica-algodon")!;
    expect(tee.variants.length).toBe(12);
    expect(typeof tee.price).toBe("number");
    // Declared options and no generated variants: a real case the store must handle.
    expect(products.some((p) => p.options.length > 0 && p.variants.length === 0)).toBe(true);
  });

  it("keeps the tables closed: row level security is on for all of them", async () => {
    const { rows } = await db.query("select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and not relrowsecurity");
    expect(rows).toEqual([]);
  });
});

describe("create_order", () => {
  it("calculates the prices in the database and ignores any price in the request", async () => {
    const before = await stock("products", "cuaderno-a5-tapa-dura");
    const lines = [{ productId: "cuaderno-a5-tapa-dura", quantity: 2, price: 1, unitPrice: 1 }] as never;
    const order = await adapter.createOrder(request({ idempotencyKey: key("1"), lines, shippingMethodId: "delivery" }), terms);
    expect(order).toMatchObject({ status: "new", paidAt: null, subtotal: 2 * 8900, shipping: { methodId: "delivery", price: 6500 }, total: 2 * 8900 + 6500 });
    expect(order.lines[0]).toMatchObject({ unitPrice: 8900, quantity: 2, variantId: null });
    expect(order).not.toHaveProperty("customer");
    expect(await stock("products", "cuaderno-a5-tapa-dura")).toBe(before! - 2);
  });

  it("is idempotent: the same key returns the same order and takes stock once", async () => {
    const before = await stock("products", "cuaderno-a5-tapa-dura");
    const again = await adapter.createOrder(request({ idempotencyKey: key("1"), lines: [{ productId: "cuaderno-a5-tapa-dura", quantity: 2 }], shippingMethodId: "delivery" }), terms);
    expect(again.total).toBe(2 * 8900 + 6500);
    expect(await stock("products", "cuaderno-a5-tapa-dura")).toBe(before);
    expect((await db.query("select count(*)::int as n from orders")).rows[0]).toEqual({ n: 1 });
  });

  it("gives free shipping from the threshold", async () => {
    const order = await adapter.createOrder(request({ idempotencyKey: key("2"), lines: [{ productId: "mochila-urbana", variantId: "mochila-urbana-black", quantity: 2 }], shippingMethodId: "delivery" }), terms);
    expect(order.subtotal).toBe(2 * 58900);
    expect(order.shipping.price).toBe(0);
    expect(order.lines[0]?.variantLabel).not.toBe("");
  });

  it("requires a complete choice when the product declares options", async () => {
    const hoodie = "sudadera-con-capucha"; // options declared, no variants
    await expect(adapter.createOrder(request({ idempotencyKey: key("3"), lines: [{ productId: hoodie, quantity: 1 }] }), terms)).rejects.toMatchObject({ code: "selection_required" });
    await expect(adapter.createOrder(request({ idempotencyKey: key("4"), lines: [{ productId: hoodie, quantity: 1, selection: { size: "m" } }] }), terms)).rejects.toMatchObject({ code: "selection_required" });
    const ok = await adapter.createOrder(request({ idempotencyKey: key("5"), lines: [{ productId: hoodie, quantity: 1, selection: { size: "m", color: "navy" } }] }), terms);
    expect(ok.lines[0]).toMatchObject({ variantId: null, unitPrice: 42500 });
    expect(ok.lines[0]?.variantLabel).toContain("M");
  });

  it("rejects unknown products, bad quantities and missing stock — and stores nothing", async () => {
    const count = async () => ((await db.query("select count(*)::int as n from orders")).rows[0] as { n: number }).n;
    const before = await count();
    await expect(adapter.createOrder(request({ idempotencyKey: key("6"), lines: [{ productId: "nope", quantity: 1 }] }), terms)).rejects.toMatchObject({ code: "unknown_product" });
    await expect(adapter.createOrder(request({ idempotencyKey: key("7"), lines: [{ productId: "lamina-decorativa-30x40", quantity: 1 }] }), terms)).rejects.toMatchObject({ code: "out_of_stock" });
    await expect(adapter.createOrder(request({ idempotencyKey: key("8"), lines: [{ productId: "cuaderno-a5-tapa-dura", quantity: 500 }] }), terms)).rejects.toMatchObject({ code: "quantity" });
    await expect(adapter.createOrder(request({ idempotencyKey: key("9"), lines: [] }), terms)).rejects.toMatchObject({ code: "empty" });
    expect(await count()).toBe(before);
  });
});

describe("payments", () => {
  let id = "";
  it("credits a payment once, and only when the amount matches", async () => {
    const order = await adapter.createOrder(request({ idempotencyKey: key("a"), lines: [{ productId: "vela-aromatica-de-soja", quantity: 1 }], paymentMethod: "online", paymentProvider: "stripe" }), { price: 0, freeFrom: null });
    id = order.id;
    const pay = (paymentId: string, amount: number, status: "approved" | "pending" = "approved") =>
      adapter.recordPayment({ provider: "stripe", paymentId, orderId: id, amount, currency: order.currency, status });

    expect(await pay("pay-wrong", 1)).toMatchObject({ firstTime: true, amountMatches: false });
    expect((await adapter.getOrder(id))?.status).toBe("new");

    expect(await pay("pay-1", order.total, "pending")).toMatchObject({ firstTime: false, amountMatches: true });
    expect((await adapter.getOrder(id))?.status).toBe("new");
    expect(await pay("pay-1", order.total)).toMatchObject({ firstTime: true, amountMatches: true });
    expect(await pay("pay-1", order.total)).toMatchObject({ firstTime: false, amountMatches: true });
    const paid = await adapter.getOrder(id);
    expect(paid?.status).toBe("paid");
    expect(paid?.paidAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await adapter.recordPayment({ provider: "stripe", paymentId: "x", orderId: "P-NOPE", amount: 1, currency: "ARS", status: "approved" })).toMatchObject({ firstTime: false, amountMatches: null });
  });

  it("claims the purchase event exactly once", async () => {
    expect(await adapter.claimPurchaseEvent(id)).toBe(true);
    expect(await adapter.claimPurchaseEvent(id)).toBe(false);
    expect(await adapter.claimPurchaseEvent("P-NOPE")).toBe(false);
    expect((await adapter.getAdminOrder(id))?.purchaseSentAt).not.toBeNull();
  });
});

describe("admin panel functions", () => {
  it("lists orders newest first, with the customer and the timeline", async () => {
    const orders = await adapter.listOrders();
    expect(orders.length).toBeGreaterThanOrEqual(4);
    expect(orders[0]?.customer.email).toBe("ana@example.com");
    expect(orders.every((o) => o.history[0]?.type === "created")).toBe(true);
    const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(orders.map((o) => o.id)).toEqual(sorted.map((o) => o.id));
    const paid = orders.find((o) => o.status === "paid")!;
    expect(paid.history.some((e) => e.type === "payment" && e.actor === "stripe")).toBe(true);
  });

  it("moves an order, records it, and refuses a stale move", async () => {
    const order = (await adapter.listOrders()).find((o) => o.status === "new")!;
    const paid = await adapter.setOrderStatus(order.id, "new", "paid", "owner@example.com");
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.history.at(-1)).toMatchObject({ type: "status", from: "new", to: "paid", actor: "owner@example.com" });
    await expect(adapter.setOrderStatus(order.id, "new", "cancelled", "other@example.com", "late")).rejects.toMatchObject({ code: "conflict" });
    await expect(adapter.setOrderStatus("P-NOPE", "new", "paid", "x")).rejects.toMatchObject({ code: "not_found" });
    const preparing = await adapter.setOrderStatus(order.id, "paid", "preparing", "owner@example.com");
    expect(preparing.history.filter((e) => e.type === "status")).toHaveLength(2);
    // paid_at is set once and kept.
    expect(preparing.paidAt).toBe(paid.paidAt);
  });

  it("returns the stock when an order is cancelled", async () => {
    const before = await stock("variants", "taza-de-ceramica-white");
    const order = await adapter.createOrder(request({ idempotencyKey: key("b"), lines: [{ productId: "taza-de-ceramica", variantId: "taza-de-ceramica-white", quantity: 2 }] }), terms);
    expect(await stock("variants", "taza-de-ceramica-white")).toBe(before! - 2);
    const cancelled = await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "Customer asked");
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Customer asked" });
    expect(await stock("variants", "taza-de-ceramica-white")).toBe(before);
  });

  it("keeps notes and tracking in the timeline", async () => {
    const order = (await adapter.listOrders())[0]!;
    await adapter.addOrderNote(order.id, "Gift wrap", "owner@example.com");
    const tracked = await adapter.setOrderTracking(order.id, "EX-42", "owner@example.com");
    expect(tracked.tracking).toBe("EX-42");
    expect(tracked.history.filter((e) => e.type === "note").map((e) => e.text)).toEqual(["Gift wrap"]);
    expect((await adapter.getOrder(order.id))?.tracking).toBe("EX-42");
    await expect(adapter.addOrderNote("P-NOPE", "x", "y")).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates, edits and pauses a product; replaces its variants; edits stock inline", async () => {
    const base = {
      id: "nueva-taza", slug: "nueva-taza", name: "Nueva taza", description: "Demo", category: "hogar", price: 5000, compareAtPrice: 6000,
      images: [{ src: "/media/x.webp", alt: "Taza", width: 800, height: 1000 }],
      options: [{ id: "color", name: "Color", values: [{ id: "red", label: "Rojo" }, { id: "blue", label: "Azul" }] }],
      variants: [{ id: "nueva-taza-red", options: { color: "red" }, stock: 3, price: null }, { id: "nueva-taza-blue", options: { color: "blue" }, stock: null, price: 5500 }],
      stock: null, featured: false, active: true, minQuantity: 1, attributes: {},
      type: "physical" as const, unit: "u", step: 1, maxQuantity: null, service: null, digital: null,
    };
    const created = await adapter.saveProduct(base);
    expect(created).toMatchObject({ id: "nueva-taza", price: 5000, compareAtPrice: 6000, active: true });
    expect(created.variants).toHaveLength(2);
    expect((await adapter.listProducts()).some((p) => p.id === "nueva-taza")).toBe(true);

    await adapter.setStock("nueva-taza", "nueva-taza-red", 7);
    expect(await stock("variants", "nueva-taza-red")).toBe(7);
    await expect(adapter.setStock("nueva-taza", "nope", 1)).rejects.toMatchObject({ code: "not_found" });

    const edited = await adapter.saveProduct({ ...base, name: "Taza editada", variants: [base.variants[0]!], active: false });
    expect(edited.name).toBe("Taza editada");
    expect(edited.variants.map((v) => v.id)).toEqual(["nueva-taza-red"]);
    expect((await adapter.listProducts()).some((p) => p.id === "nueva-taza")).toBe(false);
    expect((await adapter.listAllProducts()).find((p) => p.id === "nueva-taza")?.active).toBe(false);

    await expect(adapter.saveProduct({ ...base, id: "otra", slug: "nueva-taza" })).rejects.toMatchObject({ code: "slug_taken" });
    await expect(adapter.saveProduct({ ...base, id: "otra", slug: "otra", category: "nope" })).rejects.toMatchObject({ code: "category" });
  });
});

describe("stock that was never taken is never returned", () => {
  it("cancelling a made-to-order line does not add units", async () => {
    // "almohadon-de-lino" declares options and has no variants: nothing is taken from any stock.
    const order = await adapter.createOrder(request({ idempotencyKey: key("c"), lines: [{ productId: "almohadon-de-lino", quantity: 2, selection: Object.fromEntries((await adapter.listProducts()).find((p) => p.id === "almohadon-de-lino")!.options.map((o) => [o.id, o.values[0]!.id])) }] }), terms);
    const taken = (await db.query("select stock_taken from order_lines where order_id = $1", [order.id])).rows as { stock_taken: boolean }[];
    expect(taken).toEqual([{ stock_taken: false }]);
    // The owner starts counting stock for the product afterwards…
    await db.query("update products set options = '[]', stock = 10 where id = 'almohadon-de-lino'");
    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "x");
    // …and the cancellation must not invent 2 units.
    expect(await stock("products", "almohadon-de-lino")).toBe(10);
  });

  it("returns the stock once, even if the release runs twice", async () => {
    const before = await stock("products", "cuaderno-a5-tapa-dura");
    const order = await adapter.createOrder(request({ idempotencyKey: key("d"), lines: [{ productId: "cuaderno-a5-tapa-dura", quantity: 1 }] }), terms);
    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "x");
    await db.query("select release_order_stock($1)", [order.id]);
    expect(await stock("products", "cuaderno-a5-tapa-dura")).toBe(before);
  });
});

describe("unpaid orders expire", () => {
  it("cancels orders still in «new» after the deadline, releases their stock, and leaves the rest alone", async () => {
    const before = await stock("products", "vela-aromatica-de-soja");
    const stale = await adapter.createOrder(request({ idempotencyKey: key("e"), lines: [{ productId: "vela-aromatica-de-soja", quantity: 2 }] }), terms);
    const fresh = await adapter.createOrder(request({ idempotencyKey: key("f"), lines: [{ productId: "vela-aromatica-de-soja", quantity: 1 }] }), terms);
    const paid = await adapter.createOrder(request({ idempotencyKey: key("0"), lines: [{ productId: "vela-aromatica-de-soja", quantity: 1 }] }), terms);
    await adapter.setOrderStatus(paid.id, "new", "paid", "owner@example.com");
    // Every other order of this test file stays young: only these two are aged.
    await db.query("update orders set created_at = now() - interval '49 hours' where id = any($1)", [[stale.id, paid.id]]);
    expect(await stock("products", "vela-aromatica-de-soja")).toBe(before! - 4);

    const stillNew = (await adapter.listOrders()).filter((o) => o.status === "new").length;
    expect(await adapter.expireOrders(48, "Expired: no payment after 48 h")).toBe(1);
    expect(await adapter.expireOrders(48, "Expired: no payment after 48 h")).toBe(0);
    expect(await adapter.expireOrders(0, "never")).toBe(0);

    const expired = await adapter.getAdminOrder(stale.id);
    expect(expired).toMatchObject({ status: "cancelled", cancelReason: "Expired: no payment after 48 h" });
    expect(expired?.history.at(-1)).toMatchObject({ type: "status", from: "new", to: "cancelled", actor: "system" });
    expect((await adapter.getOrder(fresh.id))?.status).toBe("new");
    expect((await adapter.getOrder(paid.id))?.status).toBe("paid");
    expect((await adapter.listOrders()).filter((o) => o.status === "new").length).toBe(stillNew - 1);
    expect(await stock("products", "vela-aromatica-de-soja")).toBe(before! - 2);
  });

  it("a payment that arrives for a cancelled order is recorded and NOT credited", async () => {
    const order = (await adapter.listOrders()).find((o) => o.cancelReason?.startsWith("Expired"))!;
    const pay = () => adapter.recordPayment({ provider: "stripe", paymentId: "late-1", orderId: order.id, amount: order.total, currency: order.currency, status: "approved" });
    expect(await pay()).toEqual({ firstTime: true, amountMatches: true, orderStatus: "cancelled" });
    expect(await pay()).toMatchObject({ firstTime: false, orderStatus: "cancelled" });
    const after = await adapter.getAdminOrder(order.id);
    expect(after).toMatchObject({ status: "cancelled", paidAt: null });
    expect(after?.history.filter((e) => e.type === "payment" && e.from === "cancelled")).toHaveLength(1);
  });
});

// The reviewer's attack: on Supabase every new table, view and function of `public` is born with
// ALL rights for the public roles. The schema must close that by itself.
describe("with Supabase's default grants, the public key cannot write anything", () => {
  let supa: PGlite;
  const as = async (role: string, sql: string) => {
    await supa.exec(`set role ${role}`);
    try {
      return { ok: true as const, rows: (await supa.query(sql)).rows };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await supa.exec("reset role");
    }
  };

  beforeAll(async () => {
    supa = new PGlite();
    await supa.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      grant usage on schema public to anon, authenticated, service_role;`);
    await supa.exec(readFileSync("db/schema.sql", "utf8"));
    await supa.exec(readFileSync("db/schema.sql", "utf8"));
    await supa.exec(seedSql());
    await supa.exec("update products set active = false where id = 'manta-tejida'");
    await supa.exec(`select create_order('${JSON.stringify({ idempotency_key: key("9"), currency: "ARS", lines: [{ product_id: "cuaderno-a5-tapa-dura", quantity: 1 }], shipping: { method: "pickup", price: 0, free_from: null }, payment_provider: "manual", payment_method: "bank_transfer", customer: { name: "Ana", email: "ana@example.com", phone: "1" } })}'::jsonb)`);
  });

  for (const role of ["anon", "authenticated"]) {
    describe(role, () => {
      it("reads the catalogue: active products only", async () => {
        const catalog = await as(role, "select id from public_catalog");
        expect(catalog.ok).toBe(true);
        // Everything in the seed but the one product that was paused above.
        expect(catalog.rows!.length).toBe(seedProducts - 1);
        // The storage key of a digital file is in a table the public key cannot read at all.
        expect((await as(role, "select * from product_files")).ok).toBe(false);
        expect(JSON.stringify((await as(role, "select digital from products where type = 'digital'")).rows)).not.toContain("sample-");
        expect(catalog.rows).not.toContainEqual({ id: "manta-tejida" });
        expect((await as(role, "select count(*)::int as n from public_categories")).rows).toEqual([{ n: seedCategories }]);
        // Straight from the table it sees the same rows, never a paused product.
        expect((await as(role, "select count(*)::int as n from products")).rows).toEqual([{ n: seedProducts - 1 }]);
      });

      it.each([
        ["update a price through the view", "update public_catalog set price = 1"],
        ["update a category through the view", "update public_categories set name = 'hacked'"],
        ["delete through the view", "delete from public_categories"],
        ["insert through the view", "insert into public_categories (slug, name) values ('x', 'x')"],
        ["update the products table", "update products set price = 1"],
        ["update stock", "update variants set stock = 9999"],
        ["insert a product", "insert into products (id, slug, name, category, price) values ('x', 'x', 'x', 'hogar', 1)"],
        ["delete products", "delete from products"],
        ["truncate products", "truncate products cascade"],
        ["read the orders", "select * from orders"],
        ["read the order lines", "select * from order_lines"],
        ["read the timeline", "select * from order_events"],
        ["read the payments", "select * from payments"],
        ["mark an order as paid", "update orders set status = 'paid'"],
        ["create an order", `select create_order('{"idempotency_key":"zzzzzzzzzzzzzzzzzzzz"}'::jsonb)`],
        ["record a payment", "select record_payment('x', 'x', 'x', 1, 'ARS', 'approved')"],
        ["read an order", "select get_order('x')"],
        ["read the orders of the panel", "select admin_orders(10)"],
        ["read the full catalogue of the panel", "select admin_catalog()"],
        ["move an order", "select set_order_status('x', 'new', 'paid', 'x', '')"],
        ["save a product", `select save_product('{"id":"x","slug":"x","name":"x","category":"hogar","price":1}'::jsonb)`],
        ["set stock", "select set_stock('cuaderno-a5-tapa-dura', null, 9999)"],
        ["expire orders", "select expire_orders(0.0001, 'x')"],
        ["release stock", "select release_order_stock('x')"],
        ["claim the purchase event", "select claim_purchase_event('x')"],
        ["use the timeline sequence", "select nextval('order_events_id_seq')"],
      ])("cannot %s", async (_what, sql) => {
        const result = await as(role, sql);
        expect(result.ok, JSON.stringify(result)).toBe(false);
        expect(result.error).toMatch(/permission denied|row-level security|cannot (insert|update|delete)/i);
      });
    });
  }

  it("left the data untouched", async () => {
    expect((await supa.query("select min(price)::float as min from products where type = 'physical' and unit = 'u'")).rows).toEqual([{ min: 8900 }]);
    expect((await supa.query("select count(*)::int as n from categories where name = 'hacked'")).rows).toEqual([{ n: 0 }]);
    expect((await supa.query("select count(*)::int as n from orders")).rows).toEqual([{ n: 1 }]);
  });

  it("the server key (service_role) can still do its work through the functions", async () => {
    expect((await as("service_role", "select jsonb_array_length(admin_orders(10)) as n")).rows).toEqual([{ n: 1 }]);
    expect((await as("service_role", "select set_stock('cuaderno-a5-tapa-dura', null, 7) as r")).rows).toEqual([{ r: true }]);
  });
});

// ---------------------------------------------------------------------------------------------
// 0.2.0 — product types, in the real SQL.
// ---------------------------------------------------------------------------------------------
import { openDates, resolveSlot, slotsOn } from "@/lib/booking/slots";
import type { Product } from "@/lib/data/types";

describe("product types in the database", () => {
  let n = 0;
  const nextKey = () => `types-${String(++n).padStart(58, "0")}`;
  const free = { price: 0, freeFrom: null };
  const byId = async (id: string) => (await adapter.listProducts()).find((p) => p.id === id)!;
  const freeSlot = (p: Product, skip = 0) => {
    const day = openDates(p, Date.now())[1 + skip]!;
    return `${day}T${slotsOn(p, day, Date.now())[0]!.time}`;
  };
  const book = (productId: string, slot: string, quantity = 1) =>
    adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId, quantity, slot }], shippingMethodId: "delivery" }), terms);

  it("reads every type through the public view, without the storage key of a digital file", async () => {
    const products = await adapter.listProducts();
    expect(new Set(products.map((p) => p.type))).toEqual(new Set(["physical", "digital", "service", "quote"]));
    expect(await byId("mix-de-frutos-secos")).toMatchObject({ unit: "kg", step: 0.1, minQuantity: 0.1, maxQuantity: 3, stock: 25 });
    expect((await byId("clase-grupal-de-yoga")).service).toMatchObject({ durationMinutes: 60, capacity: 8, weekly: { sat: [["10:00", "12:00"]] } });
    const guide = await byId("guia-en-pdf");
    expect(guide.digital).toEqual({ name: "guia-de-ejemplo.pdf" });
    expect(JSON.stringify(products)).not.toContain("sample-guide");
    // Only the server reads the key — and the admin panel, to show that a file is loaded.
    expect(await adapter.getDigitalFile("guia-en-pdf")).toEqual({ name: "guia-de-ejemplo.pdf", file: "sample-guide.pdf" });
    expect(await adapter.getDigitalFile("taza-de-ceramica")).toBeNull();
    expect((await adapter.listAllProducts()).find((p) => p.id === "guia-en-pdf")?.digital).toEqual({ name: "guia-de-ejemplo.pdf", file: "sample-guide.pdf" });
  });

  it("sells by weight: rejects invalid quantities, takes decimal stock and rounds the total", async () => {
    const before = (await stock("products", "mix-de-frutos-secos"))!;
    for (const quantity of [0.25, 0.05, 3.1, 0, -1]) {
      await expect(adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "mix-de-frutos-secos", quantity }] }), free)).rejects.toMatchObject({ code: "quantity" });
    }
    expect(await stock("products", "mix-de-frutos-secos")).toBe(before);
    const order = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "mix-de-frutos-secos", quantity: 0.7 }, { productId: "te-en-hebras-test", quantity: 333 }] }), free).catch(() => null);
    expect(order).toBeNull(); // an unknown product: nothing is stored, nothing is taken
    expect(await stock("products", "mix-de-frutos-secos")).toBe(before);

    // 0.335 per gram × 1 g, three times: each line rounds to 0.34, the subtotal is 1.02 (as in pricing.ts).
    await db.exec(`insert into products (id, slug, name, category, price, unit, step, min_quantity, max_quantity)
                   values ('odd', 'odd', 'Odd', 'almacen', 0.335, 'g', 1, 1, 10) on conflict do nothing`);
    const three = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "odd", quantity: 1 }, { productId: "odd", quantity: 1 }, { productId: "odd", quantity: 1 }, { productId: "mix-de-frutos-secos", quantity: 0.7 }] }), free);
    expect(three.subtotal).toBe(1.02 + 13650);
    expect(three.lines.at(-1)).toMatchObject({ quantity: 0.7, unit: "kg", unitPrice: 19500, type: "physical" });
    expect(await stock("products", "mix-de-frutos-secos")).toBe(before - 0.7);
    await adapter.setOrderStatus(three.id, "new", "cancelled", "owner@example.com", "x");
    expect(await stock("products", "mix-de-frutos-secos")).toBe(before);
  });

  it("never oversells a slot with simultaneous orders, and a retry is the same booking", async () => {
    const haircut = await byId("corte-de-pelo");
    const slot = freeSlot(haircut);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => book("corte-de-pelo", slot)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "slot_taken" });
    // Nothing of the five that failed was stored.
    const start = resolveSlot(haircut, slot, Date.now()).start;
    expect((await db.query("select count(*)::int as n from order_lines where product_id = 'corte-de-pelo' and slot_start = $1", [start])).rows).toEqual([{ n: 1 }]);

    // A group class: capacity 8, twelve people at once.
    const yoga = await byId("clase-grupal-de-yoga");
    const yogaSlot = freeSlot(yoga);
    const group = await Promise.allSettled(Array.from({ length: 12 }, () => book("clase-grupal-de-yoga", yogaSlot)));
    expect(group.filter((r) => r.status === "fulfilled")).toHaveLength(8);
    // …or three seats in one order, while they fit.
    const other = freeSlot(yoga, 1);
    await book("clase-grupal-de-yoga", other, 6);
    await expect(book("clase-grupal-de-yoga", other, 3)).rejects.toMatchObject({ code: "slot_taken" });
    expect((await book("clase-grupal-de-yoga", other, 2)).lines[0]).toMatchObject({ quantity: 2, type: "service" });

    // Idempotent: the same key is the same order, and no second seat.
    const again = freeSlot(haircut, 1);
    const body = request({ idempotencyKey: nextKey(), lines: [{ productId: "corte-de-pelo", quantity: 1, slot: again }] });
    const first = await adapter.createOrder(body, terms);
    expect((await adapter.createOrder(body, terms)).id).toBe(first.id);
    expect(first.lines[0]!.slot).toEqual(resolveSlot(haircut, again, Date.now()));
  });

  it("requires a slot the service really offers", async () => {
    await expect(adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "corte-de-pelo", quantity: 1 }] }), terms)).rejects.toMatchObject({ code: "slot_required" });
    await expect(book("corte-de-pelo", "2020-01-01T09:00")).rejects.toMatchObject({ code: "slot_invalid" });
    await expect(book("corte-de-pelo", `${openDates(await byId("corte-de-pelo"), Date.now())[1]}T03:17`)).rejects.toMatchObject({ code: "slot_invalid" });
  });

  it("frees the slot when the order is cancelled or expires, and shows the rest in the agenda", async () => {
    const haircut = await byId("corte-de-pelo");
    const slot = freeSlot(haircut, 2);
    const { start } = resolveSlot(haircut, slot, Date.now());
    const until = new Date(Date.parse(start) + 1000).toISOString();
    const order = await book("corte-de-pelo", slot);
    expect(await adapter.listBookings(start, until)).toEqual([expect.objectContaining({ orderId: order.id, productId: "corte-de-pelo", seats: 1, paid: false, orderStatus: "new", customerName: "Ana Example", start })]);
    await expect(book("corte-de-pelo", slot)).rejects.toMatchObject({ code: "slot_taken" });

    await adapter.setOrderStatus(order.id, "new", "cancelled", "owner@example.com", "changed plans");
    expect(await adapter.listBookings(start, until)).toEqual([]);
    const second = await book("corte-de-pelo", slot);

    // Nobody paid it: after the deadline it is cancelled and the slot is free again.
    await db.query("update orders set created_at = now() - interval '49 hours' where id = $1", [second.id]);
    expect(await adapter.expireOrders(48, "Expired")).toBeGreaterThanOrEqual(1);
    expect((await adapter.getOrder(second.id))?.status).toBe("cancelled");
    const third = await book("corte-de-pelo", slot);
    // A PAID booking never expires.
    await adapter.setOrderStatus(third.id, "new", "paid", "owner@example.com");
    await db.query("update orders set created_at = now() - interval '49 hours' where id = $1", [third.id]);
    await adapter.expireOrders(48, "Expired");
    expect(await adapter.listBookings(start, until)).toEqual([expect.objectContaining({ orderId: third.id, paid: true })]);
  });

  it("charges shipping only when the order has something physical", async () => {
    const slot = freeSlot(await byId("corte-de-pelo"), 3);
    // A download and an appointment, and a browser that insists on "delivery": no shipping.
    const light = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "guia-en-pdf", quantity: 1 }, { productId: "corte-de-pelo", quantity: 1, slot }], shippingMethodId: "delivery" }), terms);
    expect(light).toMatchObject({ subtotal: 19900, shipping: { methodId: "none", price: 0 }, total: 19900 });
    expect(light.lines.map((l) => l.type)).toEqual(["digital", "service"]);
    // The same two plus a mug: now the shipping is charged, once.
    const mixed = await adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: "guia-en-pdf", quantity: 1 }, { productId: "taza-de-ceramica", variantId: "taza-de-ceramica-white", quantity: 1 }], shippingMethodId: "delivery" }), terms);
    expect(mixed).toMatchObject({ subtotal: 7900 + 11900, shipping: { methodId: "delivery", price: 6500 }, total: 7900 + 11900 + 6500 });
  });

  it("a quote cannot be paid before it is sent, nor for a price that changed", async () => {
    const quote = { productId: "camisetas-estampadas-para-eventos", quantity: 40, detail: "Forty tees with our logo", customer: request().customer };
    await expect(adapter.createOrder(request({ idempotencyKey: nextKey(), lines: [{ productId: quote.productId, quantity: 40 }] }), terms)).rejects.toMatchObject({ code: "quote_only" });
    await expect(adapter.createQuote({ ...quote, idempotencyKey: nextKey(), productId: "taza-de-ceramica" })).rejects.toMatchObject({ code: "not_a_quote" });
    await expect(adapter.createQuote({ ...quote, idempotencyKey: nextKey(), quantity: 5 })).rejects.toMatchObject({ code: "quantity" }); // minimum 10

    const key = nextKey();
    const enquiry = await adapter.createQuote({ ...quote, idempotencyKey: key });
    expect(enquiry).toMatchObject({ status: "quote", total: 0, quote: { sentAt: null }, shipping: { methodId: "none", price: 0 } });
    expect(enquiry.lines[0]).toMatchObject({ type: "quote", quantity: 40, unitPrice: 0, note: "Forty tees with our logo" });
    expect((await adapter.createQuote({ ...quote, idempotencyKey: key })).id).toBe(enquiry.id);

    // It cannot be paid: no payment turns an enquiry into a paid order.
    const pay = await adapter.recordPayment({ provider: "stripe", paymentId: "q-1", orderId: enquiry.id, amount: 0, currency: "ARS", status: "approved" });
    expect(pay.orderStatus).toBe("quote");
    expect(await adapter.getOrder(enquiry.id)).toMatchObject({ status: "quote", paidAt: null });

    await expect(adapter.acceptQuote(enquiry.id, 0, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });
    await expect(adapter.sendQuote(enquiry.id, "owner@example.com")).rejects.toMatchObject({ code: "quote_incomplete" });

    const priced = await adapter.setQuote(enquiry.id, { prices: [9500], shipping: 6000 }, "owner@example.com");
    expect(priced).toMatchObject({ subtotal: 380000, total: 386000, quote: { sentAt: null }, shipping: { price: 6000 } });
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });

    expect((await adapter.sendQuote(enquiry.id, "owner@example.com")).quote?.sentAt).toEqual(expect.any(String));
    for (const total of [1, 385999.99, 0]) {
      await expect(adapter.acceptQuote(enquiry.id, total, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_changed" });
    }
    // The owner changes the price after sending it: it has to be sent again.
    await adapter.setQuote(enquiry.id, { prices: [9000], shipping: 6000 }, "owner@example.com");
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_not_sent" });
    await adapter.sendQuote(enquiry.id, "owner@example.com");
    await expect(adapter.acceptQuote(enquiry.id, 386000, "manual", "bank_transfer")).rejects.toMatchObject({ code: "quote_changed" });
    expect((await adapter.getOrder(enquiry.id))?.status).toBe("quote");

    const accepted = await adapter.acceptQuote(enquiry.id, 366000, "manual", "whatsapp");
    expect(accepted).toMatchObject({ status: "new", total: 366000, paymentMethod: "whatsapp", paidAt: null });
    expect((await adapter.acceptQuote(enquiry.id, 366000, "manual", "bank_transfer")).paymentMethod).toBe("whatsapp");
    await expect(adapter.setQuote(enquiry.id, { prices: [1], shipping: 0 }, "owner@example.com")).rejects.toMatchObject({ code: "conflict" });
    await expect(adapter.acceptQuote("P-NOPE", 1, "manual", "bank_transfer")).rejects.toMatchObject({ code: "not_found" });

    // From here it is a normal order: the payment is credited only for the exact total.
    expect(await adapter.recordPayment({ provider: "stripe", paymentId: "q-2", orderId: enquiry.id, amount: 300000, currency: "ARS", status: "approved" })).toMatchObject({ amountMatches: false });
    expect(await adapter.recordPayment({ provider: "stripe", paymentId: "q-3", orderId: enquiry.id, amount: 366000, currency: "ARS", status: "approved" })).toMatchObject({ firstTime: true, amountMatches: true });
    const paid = await adapter.getAdminOrder(enquiry.id);
    expect(paid).toMatchObject({ status: "paid", total: 366000 });
    expect(paid?.history.filter((e) => e.type === "quote").map((e) => e.text)).toEqual(["priced:386000.00", "sent:386000.00", "priced:366000.00", "sent:366000.00"]);
  });

  it("an enquiry does not expire; an accepted quote counts from the moment it was accepted", async () => {
    const enquiry = await adapter.createQuote({ idempotencyKey: nextKey(), productId: "mueble-a-medida", quantity: 1, detail: "A table of 1.60 by 0.80", customer: request().customer });
    await adapter.setQuote(enquiry.id, { prices: [185000], shipping: 0 }, "owner@example.com");
    await adapter.sendQuote(enquiry.id, "owner@example.com");
    await db.query("update orders set created_at = now() - interval '100 hours' where id = $1", [enquiry.id]);
    await adapter.expireOrders(48, "Expired");
    expect((await adapter.getOrder(enquiry.id))?.status).toBe("quote");
    await adapter.acceptQuote(enquiry.id, 185000, "manual", "bank_transfer");
    await adapter.expireOrders(48, "Expired");
    expect((await adapter.getOrder(enquiry.id))?.status).toBe("new");
    await db.query("update orders set accepted_at = now() - interval '49 hours' where id = $1", [enquiry.id]);
    expect(await adapter.expireOrders(48, "Expired")).toBeGreaterThanOrEqual(1);
    expect((await adapter.getOrder(enquiry.id))?.status).toBe("cancelled");
  });

  it("saves a product of each type from the admin panel", async () => {
    const base = {
      slug: "x", name: "X", description: "", category: "servicios", price: 5000, compareAtPrice: null, images: [], options: [], variants: [],
      stock: null, featured: false, active: true, minQuantity: 1, attributes: {}, unit: "u", step: 1, maxQuantity: null, service: null, digital: null,
    };
    const service = await adapter.saveProduct({ ...base, id: "new-class", slug: "new-class", type: "service", service: { durationMinutes: 45, capacity: 4 } });
    expect(service).toMatchObject({ type: "service", service: { durationMinutes: 45, capacity: 4 }, digital: null });
    const file = await adapter.saveProduct({ ...base, id: "new-file", slug: "new-file", type: "digital", digital: { name: "book.pdf", file: "book-abc123.pdf" } });
    expect(file.digital).toEqual({ name: "book.pdf", file: "book-abc123.pdf" });
    expect((await byId("new-file")).digital).toEqual({ name: "book.pdf" });
    // Saving again without sending the key keeps the file; turning it physical drops it.
    await adapter.saveProduct({ ...base, id: "new-file", slug: "new-file", type: "digital", digital: { name: "renamed.pdf" } });
    expect(await adapter.getDigitalFile("new-file")).toEqual({ name: "renamed.pdf", file: "book-abc123.pdf" });
    await adapter.saveProduct({ ...base, id: "new-file", slug: "new-file", type: "physical" });
    expect(await adapter.getDigitalFile("new-file")).toBeNull();
    const weight = await adapter.saveProduct({ ...base, id: "new-rice", slug: "new-rice", type: "physical", unit: "kg", step: 0.5, minQuantity: 0.5, maxQuantity: 25, stock: 12.5 });
    expect(weight).toMatchObject({ unit: "kg", step: 0.5, minQuantity: 0.5, maxQuantity: 25, stock: 12.5 });
    await adapter.setStock("new-rice", null, 3.25);
    expect(await stock("products", "new-rice")).toBe(3.25);
  });
});

describe("migration 0001 → 0002: a 0.1.0 database keeps its data", () => {
  it("upgrades in place, with orders and products untouched, by either road", async () => {
    for (const road of ["migration + schema", "schema alone"]) {
      const old = new PGlite();
      await old.exec(readFileSync("db/migrations/0001_initial.sql", "utf8"));
      await old.exec(`
        insert into categories (slug, name) values ('hogar', 'Hogar');
        insert into products (id, slug, name, category, price, stock, min_quantity) values ('mug', 'mug', 'Mug', 'hogar', 1000, 5, 2);
        insert into products (id, slug, name, category, price, options) values ('tee', 'tee', 'Tee', 'hogar', 2000, '[{"id":"size","name":"Size","values":[{"id":"m","label":"M"}]}]');
        insert into variants (id, product_id, options, stock) values ('tee-m', 'tee', '{"size":"m"}', 3);`);
      const before = (await old.query(`select create_order('${JSON.stringify({ idempotency_key: "k".repeat(64), currency: "ARS", lines: [{ product_id: "mug", quantity: 2 }, { product_id: "tee", variant_id: "tee-m", quantity: 1 }], shipping: { method: "delivery", price: 500, free_from: null }, payment_provider: "manual", payment_method: "bank_transfer", customer: { name: "Ana" } })}'::jsonb) as r`)).rows[0] as { r: { id: string; total: number } };
      expect(Number(before.r.total)).toBe(4500);

      if (road === "migration + schema") await old.exec(readFileSync("db/migrations/0002_product_types.sql", "utf8"));
      await old.exec(readFileSync("db/schema.sql", "utf8"));
      await old.exec(readFileSync("db/schema.sql", "utf8")); // …and twice is still safe

      const upgraded = sqlAdapter("postgres", postgresGateway((sql, params) => old.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>));
      const products = await upgraded.listProducts();
      expect(products.find((p) => p.id === "mug")).toMatchObject({ type: "physical", unit: "u", step: 1, minQuantity: 2, stock: 3, maxQuantity: null, service: null, digital: null });
      expect(products.find((p) => p.id === "tee")?.variants).toEqual([{ id: "tee-m", options: { size: "m" }, stock: 2, price: null }]);
      const order = await upgraded.getOrder(before.r.id);
      expect(order).toMatchObject({ status: "new", total: 4500, quote: null, shipping: { methodId: "delivery", price: 500 } });
      expect(order?.lines).toEqual([
        expect.objectContaining({ productId: "mug", quantity: 2, unitPrice: 1000, type: "physical", unit: "u", slot: null }),
        expect.objectContaining({ productId: "tee", variantId: "tee-m", quantity: 1, type: "physical", unit: "u", slot: null }),
      ]);
      // The old order still behaves: cancelling it returns its stock.
      await upgraded.setOrderStatus(before.r.id, "new", "cancelled", "owner@example.com", "x");
      expect((await upgraded.listProducts()).find((p) => p.id === "mug")?.stock).toBe(5);
      // And the new features work on the upgraded database.
      const fresh = await upgraded.createOrder(request({ idempotencyKey: "m".repeat(64), lines: [{ productId: "mug", quantity: 2 }] }), terms);
      expect(fresh.total).toBe(2000 + 6500);
      await old.close();
    }
  });
});
