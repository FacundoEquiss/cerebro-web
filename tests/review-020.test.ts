// Regression tests for the independent review of 0.2.0: exact money math, the size of the signed
// receipt, daylight-saving gaps, overlapping appointments, holds and limits, and the preset
// command refusing to overwrite work. (The SQL side of the same findings: tests/sql.test.ts.)

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commerce } from "@/config/commerce";
import { existingInstant, openDates, resolveSlot, seatsOverlapping, slotsOn, zonedInstant, type BookingRules } from "@/lib/booking/slots";
import { isMultiple, multiplyMoney, roundCents, roundMillis, scaled } from "@/lib/decimal";
import { validQuantity } from "@/lib/data/availability";
import type { DataAdapter, Order, Product } from "@/lib/data/types";
import { lineTotal } from "@/lib/format";
import { priceOrder, quoteTotals } from "@/lib/orders/pricing";
import { MAX_LENGTH, signReceipt, verifyReceipt } from "@/lib/orders/receipt";
import { needsStore } from "@/lib/store-mode";
import { privateBucketIsPrivate, resetBucketCheck } from "@/lib/storage";
import { HAS_PRESETS, pristineProject, product, request } from "./helpers";

// Outside a request there is nothing to wait "after": the deferred work simply runs.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (work: () => unknown) => void work() }));

describe("money is rounded like the database rounds it (half up, on decimals)", () => {
  it("does not lose the half cent to binary floats", () => {
    expect(3.3 * 0.75).not.toBe(2.475); // the float is 2.4749999…
    expect(multiplyMoney(3.3, 0.75)).toBe(2.48);
    expect(lineTotal({ unitPrice: 3.3, quantity: 0.75 })).toBe(2.48);
    expect(multiplyMoney(0.335, 1)).toBe(0.34);
    expect(multiplyMoney(19500, 0.7)).toBe(13650);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(1.004999)).toBe(1);
    expect(roundMillis(0.1 + 0.2)).toBe(0.3);
    expect(scaled(1e-7, 2)).toBe(0n);
    expect(quoteTotals([{ quantity: 0.75 }, { quantity: 3 }], [3.3, 1.005], 0.125)).toEqual({ subtotal: 5.51, shipping: 0.13, total: 5.64 });
  });

  it("checks multiples exactly", () => {
    expect(isMultiple(0.1 + 0.2, 0.1)).toBe(true);
    expect(isMultiple(0.3004, 0.1)).toBe(true); // 0.3004 is 0.300 once rounded to thousandths, as in SQL
    expect(isMultiple(0.35, 0.1)).toBe(false);
    expect(validQuantity(product({ unit: "kg", step: 0.1, minQuantity: 0.1 }), 0.1 + 0.2, 20)).toBe(true);
    expect(isMultiple(1, 0)).toBe(false);
  });
});

describe("the signed receipt always fits in a URL", () => {
  const secret = "r".repeat(40);
  const long = (n: number, c = "x") => c.repeat(n);
  const big = (): Order => ({
    id: "P-ABCDEF0123", createdAt: "2026-03-02T10:00:00.000Z", currency: "ARS", subtotal: 50 * 12345.67, shipping: { methodId: "delivery", price: 6500 },
    total: 50 * 12345.67 + 6500, paymentProvider: "mercadopago", paymentMethod: "online", status: "new", paidAt: null, tracking: null, quote: null,
    lines: Array.from({ length: 50 }, (_, i) => ({
      productId: long(120, "p"), variantId: long(160, "v"), name: `${long(150, "n")} ${i}`, variantLabel: long(100, "l"), quantity: 1, unitPrice: 12345.67,
      image: `https://cdn.example.com/${long(560, "i")}.webp`, type: "service" as const, unit: "u",
      slot: { start: new Date(Date.UTC(2026, 2, 3, 9, i * 30)).toISOString(), end: new Date(Date.UTC(2026, 2, 3, 9, i * 30 + 30)).toISOString() },
    })),
  });

  it("an order at the limits of the schema (50 lines with slots, the longest ids) still gets a valid receipt", () => {
    const order = big();
    const token = signReceipt(order, secret);
    expect(token.length).toBeLessThanOrEqual(MAX_LENGTH);
    const read = verifyReceipt(token, secret);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Slimmed down, never changed where it matters: amounts, quantities and appointments.
    expect(read.order).toMatchObject({ id: order.id, subtotal: order.subtotal, total: order.total, shipping: order.shipping, status: "new" });
    expect(read.order.lines).toHaveLength(50);
    read.order.lines.forEach((l, i) => {
      expect(l).toMatchObject({ quantity: 1, unitPrice: 12345.67, type: "service", unit: "u", slot: order.lines[i]!.slot });
      expect(l.name.length).toBeLessThanOrEqual(40);
    });
  });

  it("keeps a normal order whole, and never carries the free text of an enquiry", () => {
    const order: Order = { ...big(), lines: big().lines.slice(0, 2).map((l) => ({ ...l, productId: "haircut", variantId: null, name: "Haircut", variantLabel: "", image: "/products/haircut.svg", note: "PRIVATE-NOTE ".repeat(150) })) };
    const token = signReceipt(order, secret);
    const read = verifyReceipt(token, secret);
    expect(read.ok && read.order.lines[0]).toMatchObject({ productId: "haircut", name: "Haircut", image: "/products/haircut.svg", slot: order.lines[0]!.slot });
    expect(Buffer.from(token.split(".")[1]!, "base64url").toString()).not.toContain("PRIVATE-NOTE");
    expect(read.ok && read.order.lines[0]).not.toHaveProperty("note");
    expect(token.length).toBeLessThan(1500);
  });
});

describe("daylight saving: a time the clocks skip is not a slot", () => {
  const night = (timeZone: string): BookingRules => ({ timeZone, weekly: { sun: [["00:00", "05:00"]], sat: [["22:00", "23:59"]] }, blockedDates: [], minNoticeHours: 0, maxDaysAhead: 400 });
  const svc = product({ type: "service", service: { durationMinutes: 30, capacity: 1 } });
  const times = (zone: string, date: string) => slotsOn(svc, date, Date.parse("2026-01-01T00:00:00Z"), night(zone)).map((s) => s.time);

  it("New York, 8 March 2026: 02:00–02:59 does not exist", () => {
    expect(existingInstant("2026-03-08", "02:30", "America/New_York")).toBeNull();
    expect(times("America/New_York", "2026-03-08")).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30"]);
    // Each slot that is offered is exactly where the clocks say.
    for (const s of slotsOn(svc, "2026-03-08", Date.parse("2026-01-01T00:00:00Z"), night("America/New_York"))) {
      expect(existingInstant("2026-03-08", s.time, "America/New_York")?.toISOString()).toBe(s.start);
    }
    expect(() => resolveSlot(svc, "2026-03-08T02:30", Date.parse("2026-01-01T00:00:00Z"), night("America/New_York"))).toThrowError(/slot_invalid/);
  });

  it("an hour that happens twice resolves to the first one, always", () => {
    // 1 November 2026, New York: 01:30 happens at 05:30Z (summer time) and again at 06:30Z.
    expect(existingInstant("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(new Set(times("America/New_York", "2026-11-01")).size).toBe(10);
  });

  it("zones that switch at midnight lose the first hour of the day (Havana, Santiago)", () => {
    for (const [zone, date] of [["America/Havana", "2026-03-08"], ["America/Santiago", "2026-09-06"]] as const) {
      expect(existingInstant(date, "00:00", zone), zone).toBeNull();
      expect(existingInstant(date, "00:30", zone), zone).toBeNull();
      expect(times(zone, date), zone).toEqual(["01:00", "01:30", "02:00", "02:30", "03:00", "03:30", "04:00", "04:30"]);
      // The edge of the day still resolves (the Agenda asks for it): the first instant of that day.
      expect(zonedInstant(date, "00:00", zone).getTime()).toBe(existingInstant(date, "01:00", zone)!.getTime());
      expect(zonedInstant(date, "00:30", zone).getTime()).toBe(existingInstant(date, "01:30", zone)!.getTime());
    }
    // A normal day is untouched.
    expect(times("America/Havana", "2026-03-15")).toHaveLength(10);
  });
});

describe("appointments: overlap, limits and holds", () => {
  const haircut = product({ id: "haircut", slug: "haircut", name: "Haircut", price: 12000, type: "service", stock: null, service: { durationMinutes: 30, capacity: 1 } });
  const guide = product({ id: "guide", slug: "guide", name: "Guide", price: 7900, type: "digital", stock: null, digital: { name: "guide.pdf" } });
  const day = () => openDates(haircut, Date.now())[2]!;
  const at = (i: number) => `${day()}T${slotsOn(haircut, day(), Date.now())[i]!.time}`;

  it("counts what overlaps, not what starts at the same minute", () => {
    const held = [{ productId: "haircut", start: "2026-03-03T10:00:00.000Z", end: "2026-03-03T11:00:00.000Z", seats: 1 }];
    expect(seatsOverlapping(held, "haircut", "2026-03-03T10:30:00.000Z", "2026-03-03T11:00:00.000Z")).toBe(1);
    expect(seatsOverlapping(held, "haircut", "2026-03-03T09:30:00.000Z", "2026-03-03T10:00:00.000Z")).toBe(0); // ends when it starts
    expect(seatsOverlapping(held, "haircut", "2026-03-03T11:00:00.000Z", "2026-03-03T11:30:00.000Z")).toBe(0);
    expect(seatsOverlapping(held, "other", "2026-03-03T10:00:00.000Z", "2026-03-03T11:00:00.000Z")).toBe(0);
    // The service lasted an hour when 10:00 was booked; today it lasts 30 minutes: 10:30 is still taken.
    const slot = at(3);
    const { start, end } = resolveSlot(haircut, slot, Date.now());
    const before = { productId: "haircut", start: new Date(Date.parse(start) - 30 * 60_000).toISOString(), end, seats: 1 };
    expect(() => priceOrder(request({ lines: [{ productId: "haircut", quantity: 1, slot }] }), [haircut], undefined, { held: [before] })).toThrowError(/slot_taken/);
  });

  it("one order cannot hoard the calendar, and a download is one per line", () => {
    const max = commerce.booking.maxSlotsPerOrder;
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: "haircut", quantity: 1, slot: at(i) }));
    expect(priceOrder(request({ lines: lines(max) }), [haircut]).lines).toHaveLength(max);
    expect(() => priceOrder(request({ lines: lines(max + 1) }), [haircut])).toThrowError(/booking_limit/);
    expect(() => priceOrder(request({ lines: [{ productId: "guide", quantity: 2 }] }), [guide])).toThrowError(/quantity/);
    expect(priceOrder(request({ lines: [{ productId: "guide", quantity: 1 }] }), [guide]).total).toBe(7900);
  });

  it("the types that need a store that remembers orders", () => {
    expect((["physical", "digital", "service", "quote"] as const).filter(needsStore)).toEqual(["digital", "service", "quote"]);
  });
});

describe("the json adapter: holds, limits per buyer, and the admin rules", () => {
  let dir: string;
  let adapter: DataAdapter;
  let n = 0;
  const key = () => (++n).toString(16).padStart(64, "0");
  const free = { price: 0, freeFrom: null };
  const who = (name: string) => ({ ...request().customer, email: `${name}@example.com` });
  let haircut: Product;
  const slot = (i: number, dayIndex = 3) => {
    const day = openDates(haircut, Date.now())[dayIndex]!;
    return `${day}T${slotsOn(haircut, day, Date.now())[i]!.time}`;
  };
  const book = (buyer: string, s: string) => adapter.createOrder(request({ idempotencyKey: key(), customer: who(buyer), lines: [{ productId: "corte-de-pelo", quantity: 1, slot: s }] }), free);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "review-"));
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "false";
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    adapter = mod.jsonAdapter;
    haircut = (await adapter.listProducts()).find((p) => p.id === "corte-de-pelo")!;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DEMO_ORDERS;
  });

  it("one buyer cannot hold more unpaid appointments than the limit", async () => {
    const max = commerce.booking.maxUnpaidPerBuyer;
    const orders = [];
    for (let i = 0; i < max; i++) orders.push(await book("hoarder", slot(i)));
    await expect(book("hoarder", slot(max))).rejects.toMatchObject({ code: "booking_limit" });
    // Someone else can; and once the first one pays, they can book again.
    expect((await book("someone", slot(max))).status).toBe("new");
    await adapter.setOrderStatus(orders[0]!.id, "new", "paid", "owner@example.com");
    expect((await book("hoarder", slot(max + 1))).status).toBe("new");
  });

  it("an unpaid hold lapses on its own: the seat is free at once, with no clean-up run", async () => {
    const s = slot(0, 4);
    const { start, end } = resolveSlot(haircut, s, Date.now());
    const held = await book("late", s);
    const paidSlot = slot(1, 4);
    const { start: paidStart, end: paidEnd } = resolveSlot(haircut, paidSlot, Date.now());
    const paid = await book("payer", paidSlot);
    await adapter.setOrderStatus(paid.id, "new", "paid", "owner@example.com");
    await expect(book("other", s)).rejects.toMatchObject({ code: "slot_taken" });
    expect(await adapter.listBookings(start, end)).toHaveLength(1);

    vi.useFakeTimers({ now: Date.now() + (commerce.booking.holdHours + 1) * 3_600_000, toFake: ["Date"] });
    try {
      // Nothing ran. The read itself stops counting the lapsed hold…
      expect(await adapter.listBookings(start, end)).toEqual([]);
      expect(await adapter.listBookings(paidStart, paidEnd)).toHaveLength(1); // a paid booking never lapses
      // …and the clean-up cancels the order, even with "orders never expire by age".
      expect(await adapter.expireOrders(0, "Expired")).toBeGreaterThanOrEqual(1);
      expect((await adapter.getOrder(held.id))?.status).toBe("cancelled");
      expect((await adapter.getOrder(paid.id))?.status).toBe("paid");
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Paid → Delivered» in one step only when nothing ships; the paid e-mail goes out once", async () => {
    const { moveOrder } = await import("@/lib/admin/orders");
    const mails = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const paidMails = () => mails.mock.calls.filter((c) => String(c[0]).startsWith("[mail:console]") && /Pago confirmado|Payment confirmed/.test(String(c[0]))).length;
    try {
      const mug = await adapter.createOrder(request({ idempotencyKey: key(), customer: who("mug"), lines: [{ productId: "vela-aromatica-de-soja", quantity: 1 }] }), free);
      await moveOrder(mug.id, "paid", "owner@example.com");
      await vi.waitFor(() => expect(paidMails()).toBe(1));
      await expect(moveOrder(mug.id, "delivered", "owner@example.com")).rejects.toMatchObject({ code: "invalid_transition" });
      // Back and forth through «Paid»: no second e-mail.
      await moveOrder(mug.id, "preparing", "owner@example.com");
      await moveOrder(mug.id, "paid", "owner@example.com");
      await new Promise((r) => setTimeout(r, 50));
      expect(paidMails()).toBe(1);

      const file = await adapter.createOrder(request({ idempotencyKey: key(), customer: who("file"), lines: [{ productId: "guia-en-pdf", quantity: 1 }] }), free);
      await moveOrder(file.id, "paid", "owner@example.com");
      expect((await moveOrder(file.id, "delivered", "owner@example.com")).status).toBe("delivered");
      await expect(adapter.createOrder(request({ idempotencyKey: key(), customer: who("two"), lines: [{ productId: "guia-en-pdf", quantity: 2 }] }), free)).rejects.toMatchObject({ code: "quantity" });
    } finally {
      mails.mockRestore();
    }
  });

  it("sending a quote says whether the e-mail really went out, and gives the customer's link", async () => {
    const { sendQuote, quoteLink } = await import("@/lib/admin/quotes");
    const enquiry = await adapter.createQuote({ idempotencyKey: key(), productId: "mueble-a-medida", quantity: 1, detail: "A table of 1.60 by 0.80", customer: who("quote") });
    expect(await quoteLink(enquiry.id)).toMatch(/\/pedido\/P-[A-F0-9]+\?t=v1\./);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      // MAIL_PROVIDER is not set here: nothing is sent, and the answer says so.
      const sent = await sendQuote(enquiry.id, { prices: [185000], shipping: 0 }, "owner@example.com");
      expect(sent.mailed).toBe(false);
      expect(sent.order.quote?.sentAt).toEqual(expect.any(String));
      expect(sent.link).toMatch(new RegExp(`/pedido/${enquiry.id}\\?t=v1\\.`));
      // The link carries the receipt of the PRICED order, not the customer's free text.
      const token = new URL(sent.link!).searchParams.get("t")!;
      expect(Buffer.from(token.split(".")[1]!, "base64url").toString()).not.toContain("A table of");
    } finally {
      info.mockRestore();
    }
  });
});

describe.skipIf(!HAS_PRESETS)("`npm run preset` does not overwrite work without being told to", () => {
  it("refuses over a catalogue that is not a preset's, keeps backups, and sets local data aside", () => {
    const root = pristineProject("preset-safe-");
    const data = mkdtempSync(join(tmpdir(), "preset-data-")); // an ABSOLUTE data folder
    try {
      const run = (...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/preset.mjs"), ...args], { encoding: "utf8", env: { ...process.env, DATA_DIR: data } });
      const catalogue = () => readFileSync(join(root, "content/products.json"), "utf8");

      // The owner already made the catalogue theirs.
      const mine = JSON.parse(catalogue());
      mine.products[0].name = "My real product";
      mine.products[0].price = 4321;
      writeFileSync(join(root, "content/products.json"), JSON.stringify(mine, null, 2));
      writeFileSync(join(data, "orders.json"), "[]");
      writeFileSync(join(data, "catalog.json"), "{}");
      const before = catalogue();

      const refused = run("moda");
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("NOT applied");
      expect(refused.stderr).toContain("content/products.json");
      expect(refused.stderr).toContain("--force");
      expect(catalogue()).toBe(before); // untouched
      expect(existsSync(join(root, ".preset-backups"))).toBe(false);
      expect(existsSync(join(data, "orders.json"))).toBe(true);

      // With --force it applies — and what was there is kept.
      const forced = run("moda", "--force");
      expect(forced.status).toBe(0);
      expect(JSON.parse(catalogue()).products[0].name).not.toBe("My real product");
      const backups = () => readdirSync(join(root, ".preset-backups"));
      expect(backups()).toHaveLength(1);
      expect(readFileSync(join(root, ".preset-backups", backups()[0]!, "content/products.json"), "utf8")).toBe(before);
      expect(existsSync(join(root, ".preset-backups", backups()[0]!, "config/brand.ts"))).toBe(true);
      // Local data pointing at the old catalogue is moved out of the way, with a copy in the backup.
      expect(existsSync(join(data, "orders.json"))).toBe(false);
      expect(existsSync(join(data, "catalog.json"))).toBe(false);
      expect(readdirSync(data).filter((f) => f.includes(".before-preset-")).sort().map((f) => f.split(".")[0])).toEqual(["catalog", "orders"]);
      expect(existsSync(join(root, ".preset-backups", backups()[0]!, "data/orders.json"))).toBe(true);

      // Now everything is a preset's again: no flag needed, and a second backup next to the first.
      expect(run("servicios").status).toBe(0);
      expect(backups()).toHaveLength(2);

      // Colours that are the owner's stop it too — unless they are left alone.
      const brand = join(root, "config/brand.ts");
      writeFileSync(brand, readFileSync(brand, "utf8").replace(/action: "#[0-9a-f]{6}"/, 'action: "#123456"'));
      expect(run("hogar").status).toBe(1);
      expect(run("hogar", "--keep-theme").status).toBe(0);
      expect(readFileSync(brand, "utf8")).toContain('action: "#123456"');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
  });

  it("refuses over uncommitted changes in a git repository", () => {
    const root = pristineProject("preset-git-");
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, stdio: "ignore" });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-q", "-m", "start");
      const run = (...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/preset.mjs"), ...args], { encoding: "utf8", env: { ...process.env, DATA_DIR: join(root, ".data") } });
      // Committed and still a preset: fine.
      expect(run("moda").status).toBe(0);
      // Now the tree has uncommitted changes (the ones the command itself just made).
      const again = run("hogar");
      expect(again.status).toBe(1);
      expect(again.stderr).toContain("uncommitted changes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the private bucket must be private", () => {
  it("refuses a public bucket, and one whose settings cannot be read", async () => {
    const answer = (body: unknown, ok = true) => vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body } as Response);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const [body, ok, expected] of [[{ public: false }, true, true], [{ public: true }, true, false], [{}, true, false], [{ message: "not found" }, false, false]] as const) {
        resetBucketCheck();
        const fetched = answer(body, ok);
        expect(await privateBucketIsPrivate()).toBe(expected);
        expect(await privateBucketIsPrivate()).toBe(expected); // remembered for a while: one request
        expect(fetched).toHaveBeenCalledTimes(1);
        fetched.mockRestore();
      }
      expect(quiet.mock.calls.some((c) => String(c[0]).includes("it is PUBLIC"))).toBe(true);
    } finally {
      quiet.mockRestore();
      resetBucketCheck();
    }
  });
});
