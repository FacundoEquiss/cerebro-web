import { describe, expect, it } from "vitest";
import { lineKey } from "@/lib/cart-key";
import { idempotencyKey, normalizeCustomer } from "@/lib/orders/idempotency";
import { buildOrder, priceOrder } from "@/lib/orders/pricing";
import { orderIdFromKey, readSeal, RECEIPT_TTL_MS, sealTotal, signReceipt, verifyReceipt } from "@/lib/orders/receipt";
import { product, request } from "./helpers";

const SECRET = "test-secret-with-more-than-32-characters";
const base = {
  seed: "seed-1",
  lines: [{ productId: "mug", quantity: 2 }],
  customer: { name: "Ana Example", email: "ana@example.com", phone: "+00 000 0001" },
  shippingMethodId: "pickup",
  paymentMethod: "bank_transfer",
};

describe("idempotency key", () => {
  it("is stable when only the formatting of the data changes", async () => {
    const a = await idempotencyKey(base);
    const b = await idempotencyKey({ ...base, customer: { name: "  Ana   Example ", email: "ANA@Example.com ", phone: "+00 (000) 0001" } });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(b).toBe(a);
  });

  it("does not depend on the order of the lines or of the selection keys", async () => {
    const lines = [
      { productId: "tee", quantity: 1, selection: { size: "m", color: "black" } },
      { productId: "mug", quantity: 2 },
    ];
    const swapped = [{ productId: "mug", quantity: 2 }, { productId: "tee", quantity: 1, selection: { color: "black", size: "m" } }];
    expect(await idempotencyKey({ ...base, lines })).toBe(await idempotencyKey({ ...base, lines: swapped }));
  });

  it("changes when the purchase really changes", async () => {
    const a = await idempotencyKey(base);
    expect(await idempotencyKey({ ...base, lines: [{ productId: "mug", quantity: 3 }] })).not.toBe(a);
    expect(await idempotencyKey({ ...base, seed: "seed-2" })).not.toBe(a);
    expect(await idempotencyKey({ ...base, paymentMethod: "whatsapp" })).not.toBe(a);
    expect(await idempotencyKey({ ...base, customer: { ...base.customer, email: "other@example.com" } })).not.toBe(a);
  });

  it("normalizes the customer the same way the server does", () => {
    expect(normalizeCustomer({ name: " Ana  Example ", email: "ANA@EXAMPLE.COM", phone: "+00 (000) 0001", notes: "  " })).toEqual({
      name: "Ana Example", email: "ana@example.com", phone: "+000000001",
    });
  });

  it("names the same order for the same key", () => {
    expect(orderIdFromKey("k1", SECRET)).toBe(orderIdFromKey("k1", SECRET));
    expect(orderIdFromKey("k1", SECRET)).not.toBe(orderIdFromKey("k2", SECRET));
    expect(orderIdFromKey("k1", SECRET)).toMatch(/^P-[A-F0-9]{10}$/);
  });
});

describe("signed receipt", () => {
  const order = buildOrder("P-TEST000001", request(), priceOrder(request(), [product()], { price: 0, freeFrom: null }), "2026-03-01T12:00:00.000Z");
  const now = Date.parse("2026-03-01T12:00:00.000Z");
  const token = signReceipt(order, SECRET, now);

  it("accepts a valid receipt and returns the order", () => {
    const result = verifyReceipt(token, SECRET, now + 1000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(order);
  });

  it("rejects an expired receipt", () => {
    expect(verifyReceipt(token, SECRET, now + RECEIPT_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered receipt", () => {
    const [v, body, sig] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ o: { ...order, total: 1 }, exp: now + RECEIPT_TTL_MS })).toString("base64url");
    expect(verifyReceipt(`${v}.${edited}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReceipt(`${v}.${body}.${sig!.slice(0, -2)}AA`, SECRET, now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReceipt(token, "another-secret-with-more-than-32-characters", now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReceipt("", SECRET)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReceipt(null, SECRET)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyReceipt("x".repeat(7000), SECRET)).toEqual({ ok: false, reason: "invalid" });
  });

  it("carries no personal data", () => {
    const payload = Buffer.from(token.split(".")[1]!, "base64url").toString("utf8");
    expect(payload).not.toContain("ana@example.com");
    expect(payload).not.toContain("Ana Example");
  });

  it("seals the total for the payment gateway", () => {
    const seal = sealTotal("P-1", 1234.5, "ARS", SECRET);
    expect(readSeal("P-1", seal, SECRET)).toEqual({ total: 1234.5, currency: "ARS" });
    expect(readSeal("P-2", seal, SECRET)).toBeNull();
    expect(readSeal("P-1", seal.replace("1234.50", "1.00"), SECRET)).toBeNull();
  });
});

describe("cart line key", () => {
  it("is the variant id when there is one", () => {
    expect(lineKey("tee", "tee-m-black", { size: "m" })).toBe("tee-m-black");
  });
  it("is the product id when there is nothing to choose", () => {
    expect(lineKey("mug")).toBe("mug");
    expect(lineKey("mug", null, {})).toBe("mug");
  });
  it("includes the choice when there is no variant, so two sizes do not collapse into one line", () => {
    const m = lineKey("hoodie", null, { size: "m", color: "black" }, ["size", "color"]);
    const l = lineKey("hoodie", null, { size: "l", color: "black" }, ["size", "color"]);
    expect(m).toBe("hoodie|m|black");
    expect(l).not.toBe(m);
    // The same choice gives the same key whatever the order of the object keys.
    expect(lineKey("hoodie", null, { color: "black", size: "m" }, ["size", "color"])).toBe(m);
  });
});
