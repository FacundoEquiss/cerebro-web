import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hashedUserData, metaPayload, sha256 } from "@/lib/analytics/server";
import { touchFrom } from "@/lib/analytics/attribution";
import { notifiableUrl } from "@/lib/indexnow";
import { verifyMercadoPagoSignature } from "@/lib/payments/mercadopago";
import { verifyStripeSignature } from "@/lib/payments/stripe";
import { matchesSeal } from "@/lib/payments/credit";
import { sealTotal } from "@/lib/orders/receipt";
import { clientIp, hit } from "@/lib/rate-limit";
import { findProblems } from "../scripts/check-brand.mjs";

describe("webhook signatures", () => {
  const secret = "whsec_test";

  it("accepts a correctly signed Stripe webhook and rejects the rest", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const t = 1_800_000_000;
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 10)).toBe(true);
    expect(verifyStripeSignature(`${body} `, `t=${t},v1=${v1}`, secret, t + 10)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, "other", t + 10)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 3600)).toBe(false); // replay
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
  });

  it("accepts a correctly signed Mercado Pago webhook and rejects the rest", () => {
    const ts = "1800000000";
    const manifest = `id:abc123;request-id:req-1;ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    const make = (signature: string, id = "ABC123") => ({
      rawBody: "{}",
      headers: new Headers({ "x-signature": signature, "x-request-id": "req-1" }),
      url: new URL(`https://example.com/api/payments/mercadopago/webhook?data.id=${id}`),
    });
    expect(verifyMercadoPagoSignature(make(`ts=${ts},v1=${v1}`), secret)).toBe(true);
    expect(verifyMercadoPagoSignature(make(`ts=${ts},v1=${v1}`, "other"), secret)).toBe(false);
    expect(verifyMercadoPagoSignature(make(`ts=${ts},v1=${"0".repeat(64)}`), secret)).toBe(false);
    expect(verifyMercadoPagoSignature(make(""), secret)).toBe(false);
    expect(verifyMercadoPagoSignature(make(`ts=${ts},v1=${v1}`), "")).toBe(false);
  });

  it("only credits a payment whose amount equals the sealed total", () => {
    const orderSecret = "order-secret-with-more-than-32-characters";
    const seal = sealTotal("P-1", 1500, "ARS", orderSecret);
    const payment = { provider: "stripe", paymentId: "p", orderId: "P-1", amount: 1500, currency: "ars", status: "approved" as const };
    expect(matchesSeal(payment, seal, orderSecret)).toBe(true);
    expect(matchesSeal({ ...payment, amount: 15 }, seal, orderSecret)).toBe(false);
    expect(matchesSeal({ ...payment, currency: "USD" }, seal, orderSecret)).toBe(false);
    expect(matchesSeal({ ...payment, orderId: "P-2" }, seal, orderSecret)).toBe(false);
    expect(matchesSeal(payment, undefined, orderSecret)).toBe(false);
  });
});

describe("measurement", () => {
  it("hashes personal data before it leaves the server", () => {
    const data = hashedUserData({ email: " Ana@Example.com ", phone: "+00 000 0001", name: "Ana María Example" });
    expect(data.em).toEqual([sha256("ana@example.com")]);
    expect(data.ph).toEqual([sha256("000000001")]);
    expect(data.fn).toEqual([sha256("ana")]);
    expect(data.ln).toEqual([sha256("example")]);
    expect(JSON.stringify(data)).not.toContain("ana@");
  });

  it("shares the event id between the pixel and the Conversions API", () => {
    const payload = metaPayload({ name: "purchase", eventId: "P-ABC", value: 100, currency: "ARS", items: [{ id: "mug", price: 100, quantity: 1 }], user: { email: "ana@example.com" } }, 1_800_000_000);
    expect(JSON.stringify(payload)).toContain('"event_id":"P-ABC"');
    expect(JSON.stringify(payload)).toContain('"event_name":"Purchase"');
  });

  it("reads where a visit came from", () => {
    expect(touchFrom("https://example.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch", "", "example.com")).toMatchObject({ source: "instagram", medium: "social", campaign: "launch" });
    expect(touchFrom("https://example.com/shop", "https://example.com/", "example.com")).toBeNull();
  });

  it("only notifies canonical, public URLs to IndexNow", () => {
    expect(notifiableUrl("/producto/taza", "https://example.com")).toBe("https://example.com/producto/taza");
    expect(notifiableUrl("/carrito", "https://example.com")).toBeNull();
    expect(notifiableUrl("/api/orders", "https://example.com")).toBeNull();
    expect(notifiableUrl("/tienda?sort=price_asc", "https://example.com")).toBeNull();
    expect(notifiableUrl("https://other.example.org/x", "https://example.com")).toBeNull();
  });
});

describe("rate limit", () => {
  it("allows up to the limit inside the window and resets after it", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hit("unit-test", 3, 1000, now).allowed).toBe(true);
    expect(hit("unit-test", 3, 1000, now + 10)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(hit("unit-test", 3, 1000, now + 1001).allowed).toBe(true);
  });
});

describe("the caller's address comes from a trusted source", () => {
  const forged = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9", "x-real-ip": "198.51.100.7", "cf-connecting-ip": "192.0.2.44" });

  it("by default takes the LAST hop of X-Forwarded-For: what the client wrote first is ignored", () => {
    expect(clientIp(forged, "")).toBe("203.0.113.9");
    // Rotating the part a client controls does not change the bucket.
    for (let i = 0; i < 5; i++) expect(clientIp(new Headers({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` }), "")).toBe("203.0.113.9");
    expect(clientIp(new Headers(), "")).toBe("unknown");
  });
  it("uses the configured platform header and nothing else", () => {
    expect(clientIp(forged, "cf-connecting-ip")).toBe("192.0.2.44");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1" }), "cf-connecting-ip")).toBe("unknown");
  });
  it("trusts no header at all with `none`", () => {
    expect(clientIp(forged, "none")).toBe("unknown");
  });
});

describe("no trace of a private brand", () => {
  it("flags ids, phones and real e-mail addresses", () => {
    // (The samples are assembled here so that this very file passes the check.)
    expect(findProblems(`id ${"1234567890".repeat(2)}`)).toHaveLength(1);
    expect(findProblems(["write to someone", "realdomain.com"].join("@"))).toHaveLength(1);
    expect(findProblems("write to hola@example.com")).toEqual([]);
    expect(findProblems(["G-", "ABCDEFGH12"].join(""))).toHaveLength(1);
  });
  it("allows hosted-platform names only in the READMEs and docs", () => {
    const name = ["shop", "ify"].join("");
    expect(findProblems(`no ${name} needed`).length).toBe(1);
    expect(findProblems(`no ${name} needed`, { docs: true })).toEqual([]);
  });
  it("passes on the whole repository", () => {
    expect(() => execFileSync("node", ["scripts/check-brand.mjs"], { stdio: "pipe" })).not.toThrow();
  });
});
