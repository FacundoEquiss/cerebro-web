import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/env";
import { feedRows, googleAvailability, googleFeedXml, metaAvailability, metaFeedXml } from "@/lib/feeds";
import { absoluteUrl } from "@/lib/url";
import { hoodie, product, tee } from "./helpers";

describe("feed availability differs by platform", () => {
  it("maps each state to the words of each platform", () => {
    expect(googleAvailability("in_stock")).toBe("in_stock");
    expect(googleAvailability("made_to_order")).toBe("in_stock");
    expect(googleAvailability("out_of_stock")).toBe("out_of_stock");
    expect(metaAvailability("in_stock")).toBe("in stock");
    expect(metaAvailability("made_to_order")).toBe("available for order");
    expect(metaAvailability("out_of_stock")).toBe("out of stock");
  });

  const categories = [{ slug: "home", name: "Home", description: "" }];
  const rows = feedRows([product(), tee({ compareAtPrice: 3000 }), hoodie()], categories, "https://example.com");

  it("emits one row per variant, with the ids the events use", () => {
    expect(rows.map((r) => r.id)).toEqual(["mug", "tee-s-black", "tee-m-black", "tee-m-white", "hoodie"]);
    expect(rows.find((r) => r.id === "tee-m-white")).toMatchObject({ groupId: "tee", price: 3000, salePrice: 2500, availability: "made_to_order", size: "M", color: "White" });
    expect(rows.find((r) => r.id === "hoodie")?.availability).toBe("made_to_order");
  });

  it("keeps absolute photo URLs (external storage) as they are", () => {
    const remote = "https://storage.example.com/bucket/mug.webp";
    const [row] = feedRows([product({ images: [{ src: remote, alt: "Mug", width: 800, height: 1000 }, { src: "/media/b.webp", alt: "Mug", width: 800, height: 1000 }] })], categories, "https://example.com");
    expect(row?.image).toBe(remote);
    expect(row?.extraImages).toEqual(["https://example.com/media/b.webp"]);
    expect(absoluteUrl(remote, "https://example.com/")).toBe(remote);
    expect(absoluteUrl("//cdn.example.com/a.webp", "https://example.com")).toBe("//cdn.example.com/a.webp");
    expect(absoluteUrl("/tienda", "https://example.com/")).toBe("https://example.com/tienda");
    expect(absoluteUrl("/", "https://example.com/")).toBe("https://example.com");
  });

  it("writes each platform's own value in its file", () => {
    const google = googleFeedXml(rows, "https://example.com");
    const meta = metaFeedXml(rows, "https://example.com");
    expect(google).toContain("<g:availability>out_of_stock</g:availability>");
    expect(google).not.toContain("available for order");
    expect(meta).toContain("<g:availability>available for order</g:availability>");
    expect(meta).toContain("<g:availability>out of stock</g:availability>");
    expect(meta).not.toContain("out_of_stock");
    expect(google).toContain("<g:price>3000.00 ARS</g:price>");
    expect(google).toContain("<g:sale_price>2500.00 ARS</g:sale_price>");
  });
});

describe("environment variables", () => {
  const secret = "x".repeat(32);
  // Outside production a missing secret is replaced by a random local one (never a constant).
  const local = () => "local-random-secret-of-this-machine-0001";
  const parse = (raw: Record<string, string | undefined>) => parseEnv(raw, local);

  it("works with nothing set: demo mode, not production, not indexable", () => {
    const e = parse({});
    expect(e).toMatchObject({ DATA_SOURCE: "json", PAYMENT_PROVIDER: "manual", MAIL_PROVIDER: "console", ORDER_EXPIRY_HOURS: 48, isDemo: true, isProduction: false, allowIndexing: false, demoMode: true, siteUrl: "http://localhost:3000" });
  });

  it("never signs with a fixed public key: without ORDER_SECRET the secret is local and random", () => {
    expect(parse({}).orderSecret).toBe(local());
    expect(parse({}).adminSecret).toBe(local());
    // The real default creates a different secret on every machine.
    const a = parseEnv({}, () => "a".repeat(40)).orderSecret;
    const b = parseEnv({}, () => "b".repeat(40)).orderSecret;
    expect(a).not.toBe(b);
  });

  it("refuses to start in production without its secrets", () => {
    expect(() => parse({ APP_ENV: "production" })).toThrow(/ORDER_SECRET is required in production/);
    expect(() => parse({ VERCEL_ENV: "production" })).toThrow(/ORDER_SECRET/);
    // Building an image needs no secret; starting the server does.
    expect(parse({ APP_ENV: "production", NEXT_PHASE: "phase-production-build" }).isProduction).toBe(true);
    expect(() => parse({ APP_ENV: "production", NEXT_PHASE: "phase-production-server" })).toThrow(/ORDER_SECRET/);
    const e = parse({ APP_ENV: "production", ORDER_SECRET: secret });
    expect(e).toMatchObject({ isProduction: true, isDemo: false, orderSecret: secret, adminSecret: secret });
    expect(parse({ APP_ENV: "production", ORDER_SECRET: secret, ADMIN_SESSION_SECRET: "y".repeat(32) }).adminSecret).toBe("y".repeat(32));
  });

  it("refuses a payment gateway without a database in production", () => {
    const gateway = { ORDER_SECRET: secret, PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w" };
    expect(() => parse({ ...gateway, APP_ENV: "production" })).toThrow(/to charge online, connect a database/);
    expect(parse({ ...gateway }).PAYMENT_PROVIDER).toBe("stripe"); // allowed on a laptop, to try it
    expect(parse({ ...gateway, APP_ENV: "production", DATA_SOURCE: "postgres", DATABASE_URL: "postgres://x" }).isProduction).toBe(true);
  });

  it("is production only when told so, and indexable only with ALLOW_INDEXING=1", () => {
    expect(parse({ APP_ENV: "production", ORDER_SECRET: secret })).toMatchObject({ isProduction: true, allowIndexing: false });
    expect(parse({ APP_ENV: "production", ORDER_SECRET: secret, ALLOW_INDEXING: "1" }).allowIndexing).toBe(true);
    expect(parse({ VERCEL_ENV: "preview", ALLOW_INDEXING: "1" }).allowIndexing).toBe(false);
    expect(parse({ NEXT_PUBLIC_SITE_URL: "https://example.com/" }).siteUrl).toBe("https://example.com");
  });

  it("fails loudly when a provider is half configured", () => {
    expect(() => parse({ DATA_SOURCE: "postgres" })).toThrow(EnvError);
    expect(() => parse({ DATA_SOURCE: "postgres", ORDER_SECRET: secret })).toThrow(/DATABASE_URL/);
    expect(() => parse({ DATA_SOURCE: "postgres", DATABASE_URL: "postgres://x" })).toThrow(/ORDER_SECRET/);
    expect(() => parse({ PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "k", ORDER_SECRET: secret })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => parse({ PAYMENT_PROVIDER: "mercadopago", MERCADOPAGO_ACCESS_TOKEN: "k", ORDER_SECRET: secret })).toThrow(/MERCADOPAGO_WEBHOOK_SECRET/);
    expect(() => parse({ ORDER_SECRET: "short" })).toThrow(/32/);
    expect(() => parse({ DATA_SOURCE: "mongo" })).toThrow(EnvError);
    expect(() => parse({ MAIL_PROVIDER: "smtp" })).toThrow(/SMTP_URL/);
    expect(() => parse({ ANTIBOT_PROVIDER: "turnstile" })).toThrow(/TURNSTILE/);
    expect(() => parse({ INDEXNOW_KEY: "no spaces allowed" })).toThrow(/INDEXNOW_KEY/);
    expect(() => parse({ CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
    expect(() => parse({ TRUSTED_PROXY_HEADER: "x real ip" })).toThrow(/TRUSTED_PROXY_HEADER/);
    expect(() => parse({ ORDER_EXPIRY_HOURS: "soon" })).toThrow(/ORDER_EXPIRY_HOURS/);
    expect(parse({ ORDER_EXPIRY_HOURS: "0" }).ORDER_EXPIRY_HOURS).toBe(0);
  });

  it("validates the admin users and their session secret", () => {
    const users = "owner@example.com:scrypt.c2FsdA.aGFzaA";
    expect(() => parse({ ADMIN_USERS: users })).toThrow(/ADMIN_SESSION_SECRET/);
    expect(() => parse({ ADMIN_USERS: "owner@example.com:plain-password", ADMIN_SESSION_SECRET: secret })).toThrow(/ADMIN_USERS/);
    const e = parse({ ADMIN_USERS: `${users}, Second@Example.com:scrypt.YQ.Yg`, ADMIN_SESSION_SECRET: secret });
    expect(e.adminUsers.map((u) => u.email)).toEqual(["owner@example.com", "second@example.com"]);
    expect(e.adminSecret).toBe(secret);
    // With real users the demo account switches itself off, unless asked for.
    expect(e.demoMode).toBe(false);
    expect(parse({ ADMIN_USERS: users, ADMIN_SESSION_SECRET: secret, DEMO_MODE: "true" }).demoMode).toBe(true);
    expect(parse({ DEMO_MODE: "false" }).demoMode).toBe(false);
  });

  it("accepts a complete configuration", () => {
    const e = parse({
      APP_ENV: "production", DATA_SOURCE: "supabase", SUPABASE_URL: "https://db.example.com", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "b",
      ORDER_SECRET: secret, PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w", MAIL_PROVIDER: "resend", RESEND_API_KEY: "r", MAIL_FROM: "shop@example.com",
    });
    expect(e).toMatchObject({ isDemo: false, isProduction: true, orderSecret: secret, adminSecret: secret });
  });
});
