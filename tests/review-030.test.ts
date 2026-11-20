// What the independent review of 0.3.0 found, each with the test that keeps it fixed.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productInputSchema } from "@/lib/admin/products";
import { isEvent, matchesRepeat, repeatDates, resolveSlot, upcomingSessions, type BookingRules } from "@/lib/booking/slots";
import { parseCatalog } from "@/lib/data/json";
import { capitalFirst } from "@/lib/format";
import { productJsonLd } from "@/lib/seo";
import { checkCatalog } from "../scripts/check-catalog.mjs";
import { diagnose } from "../scripts/doctor.mjs";
import { product, request } from "./helpers";

const rules: BookingRules = { timeZone: "America/Argentina/Buenos_Aires", weekly: {}, blockedDates: [], minNoticeHours: 0, maxDaysAhead: 60 };
const at = (iso: string) => Date.parse(iso);

describe("a real store passes its own checks: the brand scan protects the template only", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "brand-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "config"));
    cpSync("scripts/check-brand.mjs", join(root, "scripts/check-brand.mjs"));
    // What every real store has in its config: a real address and an account number.
    writeFileSync(join(root, "config/brand.ts"), `export const brand = { email: "hola@${"mitienda"}.com.ar", cbu: "${"1234567".repeat(3)}" };\n`);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const run = (env: Record<string, string>) => spawnSync(process.execPath, [join(root, "scripts/check-brand.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });

  it("skips the scan in a store, on a laptop and in the store's own CI", () => {
    for (const env of [{}, { GITHUB_REPOSITORY: "someone/my-store" }] as Record<string, string>[]) {
      const result = run(env);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("skipped");
    }
  });

  it("still runs in the CI of the template, and on a machine that has a blocklist", () => {
    const template = JSON.parse(readFileSync("package.json", "utf8")).repository?.url as string | undefined;
    // (a store made by the creator has no `repository`: there is no template CI to imitate)
    if (template) expect(run({ GITHUB_REPOSITORY: template.replace("https://github.com/", "") }).status).toBe(1);
    const list = join(root, "terms.txt");
    writeFileSync(list, "=zzzunlikelyterm\n");
    const local = run({ BRAND_BLOCKLIST_FILE: list });
    expect(local.status).toBe(1);
    expect(local.stderr).toContain("e-mail address");
  });

  it("is not part of the build, and the preset CI only runs in the template", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts).not.toHaveProperty("prebuild");
    expect(scripts.build).toBe("next build");
    if (existsSync(".github/workflows/presets.yml")) expect(readFileSync(".github/workflows/presets.yml", "utf8")).toMatch(/if: github\.repository == '[^']+\/cerebro-web'/);
  });

  it("the build config does not need tests/: deleting that folder leaves dev and build working", () => {
    expect(readFileSync("next.config.ts", "utf8")).not.toMatch(/from\s+["'][^"']*tests\//);
  });
});

describe("drafts, quotes and price 0", () => {
  const raw = (over: Record<string, unknown>) => ({ id: "x", slug: "x", name: "X", description: "", category: "c", images: [], ...over });
  const catalogue = (products: unknown[]) => parseCatalog({ categories: [{ slug: "c", name: "C" }], products } as never).products;

  it('"price": null is a draft for everything except a quote, which has no public price by nature', () => {
    const [tea, sign, hidden] = catalogue([raw({ price: null }), raw({ id: "q", slug: "q", type: "quote", price: null }), raw({ id: "h", slug: "h", type: "quote", price: null, draft: true })]);
    expect(tea).toMatchObject({ draft: true, price: 0 });
    expect(sign).toMatchObject({ draft: false, price: 0, type: "quote" });
    expect(hidden).toMatchObject({ draft: true });
  });

  it("the form refuses price 0 on something for sale; a draft and a quote may have none", () => {
    const form = (over: Record<string, unknown>) => productInputSchema.safeParse({ slug: "tea", name: "Tea", description: "", category: "c", price: 0, compareAtPrice: null, stock: 1, featured: false, active: true, minQuantity: 1, attributes: {}, images: [], options: [], variants: [], ...over });
    const refused = form({});
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({ path: ["price"], message: "price_required" });
    expect(form({ draft: true }).success).toBe(true);
    expect(form({ type: "quote" }).success).toBe(true);
    expect(form({ price: 1200 }).success).toBe(true);
    // The id is a code of the business, never shown: any reasonable one is accepted.
    expect(form({ id: "SKU_123.b", price: 5 }).success).toBe(true);
    expect(form({ id: "has space", price: 5 }).success).toBe(false);
  });
});

describe("events: a rule that repeats, dates written twice, a length per date", () => {
  const event = (service: Record<string, unknown>) => product({ id: "class", type: "service", stock: null, service: { durationMinutes: 180, capacity: 2, ...service } as never });
  const now = at("2026-11-20T12:00:00Z");

  it("«the first Saturday of each month at 10:00» gives the next dates from today, for ever", () => {
    const repeat = { week: 1 as const, weekday: "sat" as const, time: "10:00", count: 3 };
    expect(repeatDates(repeat, now, rules.timeZone)).toEqual(["2026-12-05T10:00", "2027-01-02T10:00", "2027-02-06T10:00"]);
    // Years later the same catalogue still has dates: nothing to keep up to date.
    expect(repeatDates(repeat, at("2031-06-10T12:00:00Z"), rules.timeZone)).toEqual(["2031-07-05T10:00", "2031-08-02T10:00", "2031-09-06T10:00"]);
    // The day of the session itself: before it starts it is still open, after it is not.
    expect(repeatDates(repeat, at("2026-12-05T12:59:00Z"), rules.timeZone)[0]).toBe("2026-12-05T10:00");
    expect(repeatDates(repeat, at("2026-12-05T13:00:00Z"), rules.timeZone)[0]).toBe("2027-01-02T10:00");
    expect(repeatDates({ week: "last", weekday: "fri", time: "19:00", count: 2 }, now, rules.timeZone)).toEqual(["2026-11-27T19:00", "2026-12-25T19:00"]);
    expect(repeatDates({ week: "every", weekday: "tue", time: "09:00", count: 2 }, now, rules.timeZone)).toEqual(["2026-11-24T09:00", "2026-12-01T09:00"]);
    expect(repeatDates({ week: 1, weekday: "sat", time: "10:00" }, now, rules.timeZone)).toHaveLength(3); // the default
    expect(repeatDates({ week: 1, weekday: "sat", time: "25:00" } as never, now, rules.timeZone)).toEqual([]);
    expect(matchesRepeat("2026-12-12", { week: 2, weekday: "sat" })).toBe(true);
    expect(matchesRepeat("2026-12-12", { week: 1, weekday: "sat" })).toBe(false);
  });

  it("the rule and the list add up; a blocked date is skipped; a date written twice is one", () => {
    const p = event({ repeat: { week: 1, weekday: "sat", time: "10:00", count: 2 }, blockedDates: ["2026-12-05"], sessions: [{ start: "2026-12-19T18:00", durationMinutes: 45 }, { start: "2026-12-19T18:00" }, { start: "2027-01-02T10:00" }] });
    const sessions = upcomingSessions(p, now, rules);
    expect(sessions.map((s) => s.slot)).toEqual(["2026-12-19T18:00", "2027-01-02T10:00", "2027-02-06T10:00"]);
    // The length written on a date is kept; the others take the length of the event.
    expect(sessions.map((s) => (Date.parse(s.end) - Date.parse(s.start)) / 60_000)).toEqual([45, 180, 180]);
    expect(resolveSlot(p, "2027-02-06T10:00", now, rules)).toMatchObject({ start: "2027-02-06T13:00:00.000Z" });
    expect(() => resolveSlot(p, "2026-12-05T10:00", now, rules)).toThrowError(/slot_invalid/);
  });

  it("an event stays an event with no date left, and with only a rule", () => {
    expect(isEvent(event({ sessions: [] }))).toBe(true);
    expect(isEvent(event({ repeat: { week: "every", weekday: "mon", time: "10:00" } }))).toBe(true);
    expect(isEvent(event({}))).toBe(false);
    expect(upcomingSessions(event({ sessions: [] }), now, rules)).toEqual([]);
  });

  it("the structured data says SoldOut for a date whose seats are taken", () => {
    const p = event({ sessions: [{ start: "2030-03-02T10:00" }, { start: "2030-04-06T10:00" }] });
    const [first, second] = upcomingSessions(p, Date.now());
    const ld = productJsonLd(p, undefined, [{ productId: "class", start: first!.start, end: first!.end, seats: 2 }, { productId: "class", start: second!.start, end: second!.end, seats: 1 }]) as { offers: { availability: string } }[];
    expect(ld.map((e) => e.offers.availability)).toEqual(["https://schema.org/SoldOut", "https://schema.org/InStock"]);
  });

  it("a date is written with only its first letter in capitals", () => {
    expect(capitalFirst("sábado, 6 de marzo")).toBe("Sábado, 6 de marzo");
    expect(capitalFirst("")).toBe("");
  });
});

describe("check:catalog and the doctor answer with sentences, whatever the file looks like", () => {
  let root: string;
  const write = (body: string | null, zone = "America/New_York") => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, "content"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config/commerce.ts"), `export const commerce = { booking: { timeZone: "${zone}" } };\n`);
    if (body !== null) writeFileSync(join(root, "content/products.json"), body);
  };
  const one = (p: Record<string, unknown>) => JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [{ id: "a", slug: "a", name: "A", category: "c", price: 10, images: [], ...p }] });
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "fuzz-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ["no file", null, "is not there"],
    ["an empty file", "", "not valid JSON"],
    ["null", "null", "must be an object"],
    ["a list", "[]", "must be an object"],
    ["an empty object", "{}", "`products` must be a list"],
    ["nulls inside", '{"categories":[null],"products":[null]}', "product #1 must be an object"],
    ["an empty product", '{"categories":[{"slug":"c","name":"C"}],"products":[{}]}', "has no name"],
    ["wrong types everywhere", one({ price: "12", images: "x", variants: {}, options: "no", service: 7, type: "service" }), "`images` must be a list"],
    ["negative numbers", one({ compareAtPrice: -5, stock: -3 }), "`stock` must be a number"],
  ])("%s → an error in words, no crash", (_name, body, needle) => {
    write(body);
    const result = checkCatalog(root);
    expect(result.errors.join("\n")).toContain(needle);
    expect(() => diagnose(root, {}, "es")).not.toThrow();
    const cli = spawnSync(process.execPath, ["scripts/check-catalog.mjs"], { encoding: "utf8", env: { ...process.env } });
    expect(cli.stderr).not.toMatch(/\n\s+at /); // (the CLI of the project itself: never a stack trace)
  });

  it("accepts the ids a business already has, and a quote without a price is not a draft", () => {
    write(JSON.stringify({ categories: [{ slug: "c", name: "C" }], products: [
      { id: "SKU_123", slug: "tee", name: "Tee", category: "c", price: 10, images: [] },
      { id: "q", slug: "q", name: "Sign", category: "c", price: null, type: "quote", images: [] },
      { id: "later", slug: "later", name: "Later", category: "c", price: null, images: [] },
    ] }));
    const result = checkCatalog(root);
    expect(result.errors).toEqual([]);
    expect(result.drafts).toEqual(["later"]);
  });

  it("warns about what would surprise the owner of an event", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const service = (s: Record<string, unknown>) => one({ type: "service", service: { durationMinutes: 60, capacity: 2, ...s } });
    const warnings = (s: Record<string, unknown>) => {
      write(service(s));
      const result = checkCatalog(root, now);
      expect(result.errors, JSON.stringify(s)).toEqual([]);
      return result.warnings.join("\n");
    };
    // 02:30 on the day New York jumps from 02:00 to 03:00 does not exist.
    expect(warnings({ sessions: [{ start: "2027-03-14T02:30" }, { start: "2027-03-15T02:30" }] })).toContain("2027-03-14T02:30 does not exist in America/New_York");
    expect(warnings({ sessions: [{ start: "2027-03-15T02:30" }] })).not.toContain("does not exist");
    expect(warnings({ sessions: [{ start: "2025-01-10T10:00" }] })).toContain("no date left");
    expect(warnings({ sessions: [] })).toContain("no date left");
    // A rule that repeats never runs out.
    expect(warnings({ sessions: [{ start: "2025-01-10T10:00" }], repeat: { week: 1, weekday: "sat", time: "10:00" } })).not.toContain("no date left");
    expect(warnings({ sessions: [{ start: "2027-05-01T10:00" }, { start: "2027-05-01T10:00" }] })).toContain("written twice");
    expect(warnings({ sessions: [{ start: "2027-05-01T10:00" }, { start: "2027-05-01T10:30" }] })).toContain("overlap");
    expect(warnings({ sessions: [{ start: "2027-05-01T10:00" }, { start: "2027-05-01T11:00" }] })).not.toContain("overlap");
    write(service({ repeat: { week: 5, weekday: "sat", time: "10:00" } }));
    expect(checkCatalog(root, now).errors.join("\n")).toContain("service.repeat");
    write(service({ sessions: [{ start: "2027-05-01T10:00", durationMinutes: -5 }] }));
    expect(checkCatalog(root, now).errors.join("\n")).toContain("durationMinutes");
  });

  it("the doctor: an admin user that cannot sign in is «missing», and a project without brand.ts is told so", () => {
    write(one({}));
    const user = "owner@example.com:scrypt.aaaa.bbbb";
    const half = diagnose(root, { ADMIN_USERS: user }, "es").items as { ok: boolean | null; text: string }[];
    expect(half.find((i) => i.text.includes("ADMIN_SESSION_SECRET"))).toMatchObject({ ok: false });
    expect(half.some((i) => i.ok === true && i.text.includes("usuario(s)"))).toBe(false);
    expect(half.some((i) => i.ok === false && i.text.includes("No está config/brand.ts"))).toBe(true);
    const whole = diagnose(root, { ADMIN_USERS: user, ADMIN_SESSION_SECRET: "s".repeat(32) }, "en").items as { ok: boolean | null; text: string }[];
    expect(whole.find((i) => i.text.includes("1 user(s)"))).toMatchObject({ ok: true });
    const cli = spawnSync(process.execPath, ["scripts/doctor.mjs", "--env", join(root, "nope.env"), "--lang", "en"], { encoding: "utf8" });
    expect(cli.stdout).toContain("does not exist");
    expect(cli.stdout).not.toContain("— + process.env");
  });
});

describe("example orders do not follow the store out of demo mode", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "seeded-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DEMO_ORDERS;
  });

  it("seeded while it was a demo, gone once demo mode is off — the real orders stay", async () => {
    process.env.DATA_DIR = dir;
    process.env.DEMO_ORDERS = "true";
    const mod = await import("@/lib/data/json");
    mod.resetJsonStore();
    const seeded = await mod.jsonAdapter.listOrders();
    expect(seeded.length).toBeGreaterThan(3);
    const simple = (await mod.jsonAdapter.listProducts()).find((p) => p.type === "physical" && p.options.length === 0 && (p.stock ?? 0) > 2)!;
    const real = await mod.jsonAdapter.createOrder(request({ idempotencyKey: "9".repeat(64), lines: [{ productId: simple.id, quantity: 1 }] }), { price: 0, freeFrom: null });
    expect(JSON.parse(readFileSync(join(dir, "orders.json"), "utf8")).length).toBe(seeded.length + 1);

    // The same folder, now a real store (a new process: the store is read again).
    process.env.DEMO_ORDERS = "false";
    mod.resetJsonStore();
    expect((await mod.jsonAdapter.listOrders()).map((o) => o.id)).toEqual([real.id]);
    expect(JSON.parse(readFileSync(join(dir, "orders.json"), "utf8")).map((o: { id: string }) => o.id)).toEqual([real.id]);
  });
});
