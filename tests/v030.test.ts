// 0.3.0: the tests have their own store (fixtures), the catalogue checker, the doctor, drafts
// (a product without a price), events with fixed dates, and the one-command creator.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brand } from "@/config/brand";
import { isEvent, openDates, resolveSlot, slotsOn, upcomingSessions, type BookingRules } from "@/lib/booking/slots";
import { productInputSchema, toProductInput } from "@/lib/admin/products";
import { parseCatalog } from "@/lib/data/json";
import type { DataAdapter } from "@/lib/data/types";
import { feedRows } from "@/lib/feeds";
import { priceOrder } from "@/lib/orders/pricing";
import { productJsonLd } from "@/lib/seo";
import { homeContent } from "@/lib/site";
import fixture from "@/content/products.json";
import { checkCatalog } from "../scripts/check-catalog.mjs";
import { diagnose } from "../scripts/doctor.mjs";
import { product, request } from "./helpers";

describe("the tests run against their own store, never the owner's", () => {
  it("reads the catalogue, the home texts and the brand of tests/fixtures", async () => {
    const own = JSON.parse(readFileSync("tests/fixtures/products.json", "utf8"));
    expect(fixture.products.map((p) => p.id)).toEqual(own.products.map((p: { id: string }) => p.id));
    expect(brand.name).toBe("Tienda de Prueba");
    expect(homeContent().heroTitle).toBe(JSON.parse(readFileSync("tests/fixtures/site.json", "utf8")).home.heroTitle.es);
    const { jsonAdapter } = await import("@/lib/data/json");
    expect((await jsonAdapter.listAllProducts()).map((p) => p.id).sort()).toEqual(own.products.map((p: { id: string }) => p.id).sort());
    // The fixture is a complete store: every type, sale by weight, options with and without variants.
    const { products } = parseCatalog(own);
    expect(new Set(products.map((p) => p.type))).toEqual(new Set(["physical", "digital", "service", "quote"]));
    expect(products.some((p) => p.unit === "kg")).toBe(true);
  });

  it("the owner's catalogue is valid, whatever it is", () => {
    expect(checkCatalog().errors).toEqual([]);
  });
});

describe("check:catalog", () => {
  const write = (root: string, catalogue: unknown, site: unknown = { home: {} }) => {
    mkdirSync(join(root, "content"), { recursive: true });
    mkdirSync(join(root, "public/products"), { recursive: true });
    writeFileSync(join(root, "public/products/a.svg"), "<svg/>");
    writeFileSync(join(root, "content/products.json"), JSON.stringify(catalogue));
    writeFileSync(join(root, "content/site.json"), JSON.stringify(site));
  };
  const base = { id: "tea", slug: "tea", name: "Tea", description: "Green tea.", category: "pantry", price: 1200, images: [{ src: "/products/a.svg", alt: "Tea" }] };
  const categories = [{ slug: "pantry", name: "Pantry" }];
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "catalog-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a catalogue that is finished", () => {
    write(root, { categories, products: [base, { ...base, id: "rice", slug: "rice", unit: "kg", step: 0.5, minQuantity: 0.5 }] });
    expect(checkCatalog(root)).toMatchObject({ errors: [], warnings: [], drafts: [], examples: [], products: 2 });
  });

  it("stops on what would break the store", () => {
    write(root, {
      categories,
      products: [
        base,
        { ...base, id: "tea-2" }, // same slug
        { ...base, id: "Bad Id", slug: "bad-id" },
        { ...base, id: "ghost", slug: "ghost", category: "nowhere" },
        { ...base, id: "kind", slug: "kind", type: "rental" },
        { ...base, id: "pic", slug: "pic", images: [{ src: "/products/missing.svg", alt: "x" }] },
        { ...base, id: "step", slug: "step", unit: "kg", step: 0.5, minQuantity: 0.25 },
        { ...base, id: "class", slug: "class", type: "service" },
        { ...base, id: "event", slug: "event", type: "service", service: { durationMinutes: 60, capacity: 5, sessions: [{ start: "5 March at 10" }] } },
        { ...base, id: "file", slug: "file", type: "digital" },
        { ...base, id: "var", slug: "var", options: [{ id: "size", name: "Size", values: [{ id: "m", label: "M" }] }], variants: [{ id: "var-xl", options: { size: "xl" }, stock: 1 }] },
        { ...base, id: "price", slug: "price", price: "cheap" },
      ],
    });
    const { errors } = checkCatalog(root);
    for (const needle of ['the slug "tea" is used twice', '"Bad Id"', 'category "nowhere" does not exist', 'type "rental"', "missing.svg is not in public/", "not a multiple of the step", "a service needs", "YYYY-MM-DDTHH:MM", "digital.name", 'variant "var-xl"', "the price must be a number"]) {
      expect(errors.some((e: string) => e.includes(needle)), needle).toBe(true);
    }
  });

  it("lists what is not finished: drafts, example texts, a price of 0, an event with no date left", () => {
    write(
      root,
      {
        categories: [{ slug: "pantry", name: "Pantry", description: "Texto de EJEMPLO." }],
        products: [
          { ...base, price: null },
          { ...base, id: "later", slug: "later", draft: true },
          { ...base, id: "free", slug: "free", price: 0 },
          { ...base, id: "quote", slug: "quote", type: "quote", price: 0, description: "COMPLETAR" },
          { ...base, id: "past", slug: "past", type: "service", service: { durationMinutes: 60, capacity: 5, sessions: [{ start: "2020-01-01T10:00" }] } },
          { ...base, id: "book", slug: "book", type: "digital", digital: { name: "book.pdf" } },
        ],
      },
      { home: { heroTitle: { es: "Tu título. EJEMPLO", en: "EXAMPLE" } } },
    );
    const result = checkCatalog(root);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toEqual(["tea", "later"]);
    expect(result.examples).toEqual(["category pantry", "product quote", "the home texts (content/site.json)"]);
    expect(result.warnings.map((w: string) => w.replace(/^product "([^"]+)".*?(costs 0|no date left|no file yet).*$/, "$1: $2"))).toEqual(["free: costs 0", "past: no date left", "book: no file yet"]);
    // The command says it and does not fail: a draft is a pending question, not a broken store.
    const cli = spawnSync(process.execPath, ["scripts/check-catalog.mjs"], { encoding: "utf8" });
    expect(cli.status).toBe(0);
  });
});

describe("drafts: a product whose price is not known yet", () => {
  it('`"price": null` in the catalogue file is a draft, never a price', () => {
    const { products } = parseCatalog({ categories: [], products: [{ id: "a", slug: "a", name: "A", description: "", category: "c", price: null, images: [] }, { id: "b", slug: "b", name: "B", description: "", category: "c", price: 500, images: [] }] });
    expect(products.map((p) => [p.id, p.draft, p.price])).toEqual([["a", true, 0], ["b", false, 500]]);
  });

  it("is hidden from the store and cannot be ordered; the admin panel still has it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drafts-"));
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "false";
    try {
      const mod = await import("@/lib/data/json");
      mod.resetJsonStore();
      const adapter: DataAdapter = mod.jsonAdapter;
      const category = (await adapter.listCategories())[0]!.slug;
      const form = productInputSchema.parse({ slug: "oil", name: "Olive oil", description: "", category, price: 0, compareAtPrice: null, stock: null, featured: true, active: true, draft: true, minQuantity: 1, attributes: {}, images: [], options: [], variants: [] });
      const saved = await adapter.saveProduct(toProductInput(form));
      expect(saved).toMatchObject({ id: "oil", draft: true, active: true });
      expect((await adapter.listProducts()).some((p) => p.id === "oil")).toBe(false);
      expect((await adapter.listAllProducts()).find((p) => p.id === "oil")).toMatchObject({ draft: true });
      // Not listed → not in the feeds, the sitemap, llms.txt or the structured data, which all read listProducts().
      expect(feedRows(await adapter.listProducts(), await adapter.listCategories(), "https://www.example.com").some((r) => r.id === "oil")).toBe(false);
      await expect(adapter.createOrder(request({ lines: [{ productId: "oil", quantity: 1 }] }), { price: 0, freeFrom: null })).rejects.toMatchObject({ code: "unknown_product" });
      // The owner gives the price: now it is for sale.
      await adapter.saveProduct({ ...saved, price: 9800, draft: false });
      expect((await adapter.listProducts()).find((p) => p.id === "oil")).toMatchObject({ price: 9800, draft: false });
      expect((await adapter.createOrder(request({ idempotencyKey: "9".repeat(64), lines: [{ productId: "oil", quantity: 1 }] }), { price: 0, freeFrom: null })).total).toBe(9800);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATA_DIR;
      delete process.env.DEMO_ORDERS;
      (await import("@/lib/data/json")).resetJsonStore();
    }
  });
});

describe("events: fixed dates and limited places", () => {
  const rules: BookingRules = { timeZone: "UTC", weekly: { mon: [["09:00", "12:00"]] }, blockedDates: ["2026-04-11"], minNoticeHours: 48, maxDaysAhead: 7 };
  const now = Date.parse("2026-03-02T08:00:00.000Z");
  const workshop = product({
    id: "workshop", slug: "workshop", name: "Cooking workshop", price: 32000, type: "service", stock: null,
    service: { durationMinutes: 180, capacity: 12, sessions: [{ start: "2026-04-11T10:00" }, { start: "2026-02-07T10:00" }, { start: "2026-03-07T10:00", durationMinutes: 120 }, { start: "not a date" }] },
  });

  it("is a service with a list of dates: only those exist, in order, and the past ones are gone", () => {
    expect(isEvent(workshop)).toBe(true);
    expect(isEvent(product({ type: "service", service: { durationMinutes: 30, capacity: 1 } }))).toBe(false);
    expect(upcomingSessions(workshop, now, rules)).toEqual([
      { date: "2026-03-07", time: "10:00", slot: "2026-03-07T10:00", start: "2026-03-07T10:00:00.000Z", end: "2026-03-07T12:00:00.000Z" },
      { date: "2026-04-11", time: "10:00", slot: "2026-04-11T10:00", start: "2026-04-11T10:00:00.000Z", end: "2026-04-11T13:00:00.000Z" },
    ]);
    // The weekly agenda, the closed days, the notice and the calendar window are for appointments, not for events.
    expect(openDates(workshop, now, rules)).toEqual(["2026-03-07", "2026-04-11"]);
    expect(slotsOn(workshop, "2026-03-09", now, rules)).toEqual([]); // a Monday of the weekly agenda: not an event date
    expect(slotsOn(workshop, "2026-04-11", now, rules)).toHaveLength(1);
    expect(resolveSlot(workshop, "2026-03-07T10:00", now, rules)).toEqual({ start: "2026-03-07T10:00:00.000Z", end: "2026-03-07T12:00:00.000Z" });
    for (const slot of ["2026-02-07T10:00", "2026-03-07T11:00", "2026-03-09T09:00"]) expect(() => resolveSlot(workshop, slot, now, rules)).toThrowError(/slot_invalid/);
    // Once the last date passed there is nothing to book — and it is still an event, not a weekly service.
    expect(upcomingSessions(workshop, Date.parse("2027-01-01T00:00:00Z"), rules)).toEqual([]);
    expect(openDates(workshop, Date.parse("2027-01-01T00:00:00Z"), rules)).toEqual([]);
  });

  it("sells places through the booking engine: capacity per date, whole seats, the server's price", () => {
    const soon = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const event = product({ id: "talk", slug: "talk", name: "Talk", price: 5000, type: "service", stock: null, service: { durationMinutes: 90, capacity: 12, sessions: [{ start: `${soon}T19:00` }] } });
    const slot = `${soon}T19:00`;
    const { start, end } = resolveSlot(event, slot, Date.now());
    const buy = (quantity: number, seats = 0) => priceOrder(request({ lines: [{ productId: "talk", quantity, slot }] }), [event], undefined, { held: seats ? [{ productId: "talk", start, end, seats }] : [] });
    expect(buy(4)).toMatchObject({ subtotal: 20000, shippingMethodId: "none", shippingPrice: 0, lines: [{ type: "service", quantity: 4, slot: { start, end } }] });
    expect(buy(2, 10).total).toBe(10000);
    expect(() => buy(3, 10)).toThrowError(/slot_taken/);
    expect(() => buy(1.5)).toThrowError(/quantity/);
    expect(() => priceOrder(request({ lines: [{ productId: "talk", quantity: 1 }] }), [event])).toThrowError(/slot_required/);
  });

  it("is described as an Event per date, and the admin form keeps the dates", () => {
    const soon = (days: number) => `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T10:00`;
    const event = product({ id: "talk", slug: "talk", name: "Talk", price: 5000, type: "service", stock: null, service: { durationMinutes: 90, capacity: 12, sessions: [{ start: soon(20) }, { start: soon(50) }, { start: "2020-01-01T10:00" }] } });
    const ld = productJsonLd(event) as Record<string, unknown>[];
    expect(ld).toHaveLength(2);
    expect(ld[0]).toMatchObject({ "@type": "Event", name: "Talk", eventStatus: "https://schema.org/EventScheduled", offers: { "@type": "Offer", price: "5000.00" }, organizer: { "@id": expect.stringContaining("#organization") } });
    expect(new Date(String(ld[0]!.endDate)).getTime() - new Date(String(ld[0]!.startDate)).getTime()).toBe(90 * 60_000);
    expect(ld[0]).not.toHaveProperty("location"); // the fixture brand has no address: none is made up
    // No date left: it falls back to a plain Service, never an Event without a date.
    expect(productJsonLd({ ...event, service: { ...event.service!, sessions: [{ start: "2020-01-01T10:00" }] } })).toMatchObject({ "@type": "Service" });

    const form = productInputSchema.safeParse({ slug: "talk", name: "Talk", description: "", category: "c", price: 5000, compareAtPrice: null, stock: null, featured: false, active: true, minQuantity: 1, attributes: {}, images: [], options: [], variants: [], type: "service", service: event.service });
    expect(form.success && toProductInput(form.data).service?.sessions).toHaveLength(3);
    expect(productInputSchema.safeParse({ ...(form.success ? form.data : {}), service: { durationMinutes: 90, capacity: 12, sessions: [{ start: "tomorrow" }] } }).success).toBe(false);
  });
});

describe("npm run doctor", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "doctor-"));
    for (const dir of ["content", "config", "public"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [{ id: "tea", slug: "tea", name: "Tea", description: "Green tea.", category: "c", price: 1200, images: [] }] }));
    writeFileSync(join(root, "content/site.json"), JSON.stringify({ home: {} }));
    writeFileSync(join(root, "config/brand.ts"), 'export const brand = { locale: "es", name: "Raíces", contact: { email: "hola@example.org", whatsapp: null } };');
    writeFileSync(join(root, "config/commerce.ts"), "// EXAMPLE in a comment does not count\nexport const commerce = { price: 100 };");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("says what is ready and names ONE next step, in order", () => {
    const steps: string[] = [];
    const env: Record<string, string> = {};
    const next = () => diagnose(root, env, "en").next ?? "done";
    steps.push(next()); // the database first
    Object.assign(env, { DATA_SOURCE: "supabase", SUPABASE_URL: "https://x.example.com", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "b" });
    steps.push(next());
    env.ORDER_SECRET = "s".repeat(32);
    steps.push(next());
    env.ADMIN_USERS = "owner@example.com:scrypt.aa.bb";
    steps.push(next()); // with an admin user, demo mode is already off
    Object.assign(env, { MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", MAIL_FROM: "Store <store@example.com>" });
    steps.push(next());
    env.ORDER_NOTIFY_EMAIL = "owner@example.com";
    steps.push(next());
    env.NEXT_PUBLIC_SITE_URL = "https://www.example.com";
    steps.push(next());
    env.ALLOW_INDEXING = "1";
    steps.push(next());
    expect(steps.map((s) => s.split(/[:(]/)[0]!.trim())).toEqual([
      "Orders are not stored", "ORDER_SECRET is missing", "There is no admin user", "No e-mail is sent", "ORDER_NOTIFY_EMAIL is missing", "NEXT_PUBLIC_SITE_URL is missing", "Search engines do not index the store", "done",
    ]);
    const final = diagnose(root, env, "en");
    expect(final.items.filter((i: { ok: boolean | null }) => i.ok === false)).toEqual([]);
    expect(final.items.some((i: { text: string }) => i.text.includes("Raíces"))).toBe(true);
  });

  it("names the drafts, the example data and a gateway without its keys — in Spanish too", () => {
    writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [{ id: "tea", slug: "tea", name: "Tea", description: "EJEMPLO", category: "c", price: null, images: [] }, { id: "class", slug: "class", name: "Class", description: "", category: "c", price: 10, type: "service", service: { durationMinutes: 60, capacity: 1 }, images: [] }] }));
    const { items, next } = diagnose(root, { PAYMENT_PROVIDER: "stripe", DEMO_MODE: "true" }, "es");
    const texts = items.map((i: { text: string }) => i.text).join("\n");
    expect(next).toContain("EJEMPLO");
    for (const needle of ["1 producto(s) en borrador", "tea", "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET", "El modo demo sigue encendido", "sin base de datos no se pueden vender por la web"]) expect(texts, needle).toContain(needle);
    const cli = spawnSync(process.execPath, ["scripts/doctor.mjs", "--lang", "en"], { encoding: "utf8" });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain("NEXT STEP:");
  });
});

describe("create-cerebro-web", () => {
  const cli = join(process.cwd(), "packages/create-cerebro-web/index.mjs");
  const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, CEREBRO_WEB_TEMPLATE: process.cwd() } });
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "create-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it.skipIf(!existsSync("content/presets/almacen.json"))("creates a store from the template with a preset, without asking anything", () => {
    const created = run(work, "Mi Dietética", "--preset", "almacen", "--no-install");
    expect(created.status, created.stderr).toBe(0);
    const store = join(work, "Mi Dietética");
    const pkg = JSON.parse(readFileSync(join(store, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "mi-dietetica", version: "0.1.0", private: true });
    expect(pkg).not.toHaveProperty("repository");
    expect(JSON.parse(readFileSync(join(store, "content/site.json"), "utf8")).preset).toBe("almacen");
    expect(JSON.parse(readFileSync(join(store, "content/products.json"), "utf8")).products).toEqual(JSON.parse(readFileSync("content/presets/almacen.json", "utf8")).products);
    for (const there of ["AGENTS.md", "app", "lib", "db/schema.sql", "scripts/preset.mjs", "docs/go-live.es.md", ".env.example", ".git"]) expect(existsSync(join(store, there)), there).toBe(true);
    // Nothing of the template's own repository, nothing private, nothing heavy.
    for (const gone of ["packages", "node_modules", ".next", ".data", ".brand-blocklist", ".env", ".env.local", ".preset-backups"]) expect(existsSync(join(store, gone)), gone).toBe(false);
    expect(created.stdout).toContain("npm run doctor");
    expect(created.stdout).toContain("npm install"); // it was skipped, so it is the first thing to do
    // The new store passes its own catalogue check.
    expect(spawnSync(process.execPath, ["scripts/check-catalog.mjs"], { cwd: store, encoding: "utf8" }).status).toBe(0);
  }, 120_000);

  it("refuses a folder that is in use and a preset that does not exist, leaving nothing behind", () => {
    mkdirSync(join(work, "taken"));
    writeFileSync(join(work, "taken/file.txt"), "mine");
    const taken = run(work, "taken", "--yes", "--no-install", "--lang", "en");
    expect(taken.status).toBe(1);
    expect(taken.stderr).toContain("already exists");
    expect(readFileSync(join(work, "taken/file.txt"), "utf8")).toBe("mine");
    if (!existsSync("content/presets")) return;
    const unknown = run(work, "other", "--preset", "nope", "--no-install", "--no-git", "--lang", "en");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('no preset "nope"');
    expect(existsSync(join(work, "other"))).toBe(false);
  }, 120_000);
});
