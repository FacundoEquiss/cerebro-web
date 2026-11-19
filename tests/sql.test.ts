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
  ((await db.query(`select stock from ${table} where id = $1`, [id])).rows[0] as { stock: number | null }).stock;

describe("catalogue", () => {
  it("reads the demo catalogue through the public views", async () => {
    const products = await adapter.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(10);
    expect(await adapter.listCategories()).toHaveLength(3);
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
        expect(catalog.rows!.length).toBe(12);
        expect(catalog.rows).not.toContainEqual({ id: "manta-tejida" });
        expect((await as(role, "select count(*)::int as n from public_categories")).rows).toEqual([{ n: 3 }]);
        // Straight from the table it sees the same rows, never a paused product.
        expect((await as(role, "select count(*)::int as n from products")).rows).toEqual([{ n: 12 }]);
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
    expect((await supa.query("select min(price)::float as min from products")).rows).toEqual([{ min: 8900 }]);
    expect((await supa.query("select count(*)::int as n from categories where name = 'hacked'")).rows).toEqual([{ n: 0 }]);
    expect((await supa.query("select count(*)::int as n from orders")).rows).toEqual([{ n: 1 }]);
  });

  it("the server key (service_role) can still do its work through the functions", async () => {
    expect((await as("service_role", "select jsonb_array_length(admin_orders(10)) as n")).rows).toEqual([{ n: 1 }]);
    expect((await as("service_role", "select set_stock('cuaderno-a5-tapa-dura', null, 7) as r")).rows).toEqual([{ r: true }]);
  });
});
