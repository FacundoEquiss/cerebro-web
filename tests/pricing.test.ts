import { describe, expect, it } from "vitest";
import { OrderError } from "@/lib/data/types";
import { priceOrder, shippingPrice } from "@/lib/orders/pricing";
import { orderRequestSchema } from "@/lib/orders/schema";
import { hoodie, KEY, product, request, tee } from "./helpers";

const catalog = [product(), tee(), hoodie()];
const terms = { price: 500, freeFrom: 5000 };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof OrderError ? e.code : `other:${String(e)}`;
  }
  return "no error";
};

describe("the server sets the price", () => {
  it("prices lines from the catalogue", () => {
    const priced = priceOrder(request({ lines: [{ productId: "mug", quantity: 2 }, { productId: "tee", variantId: "tee-m-white", quantity: 1 }] }), catalog, terms);
    expect(priced.subtotal).toBe(2 * 1000 + 2500);
    expect(priced.shippingPrice).toBe(500);
    expect(priced.total).toBe(5000);
    expect(priced.lines[1]).toMatchObject({ variantId: "tee-m-white", variantLabel: "M · White", unitPrice: 2500 });
  });

  it("ignores a price sent by the client", () => {
    // The schema drops unknown keys: `price`, `unitPrice` and `total` never get past it…
    const parsed = orderRequestSchema.parse({
      idempotencyKey: KEY,
      lines: [{ productId: "mug", quantity: 1, price: 1, unitPrice: 1 }],
      customer: request().customer,
      shippingMethodId: "pickup",
      paymentMethod: "bank_transfer",
      total: 1,
    });
    expect(parsed.lines[0]).not.toHaveProperty("price");
    expect(parsed).not.toHaveProperty("total");
    // …and even if one arrived, the pricing never reads it.
    const tampered = [{ productId: "mug", quantity: 1, price: 1, unitPrice: 1 }] as never;
    expect(priceOrder(request({ lines: tampered }), catalog, terms).total).toBe(1000 + 500);
  });

  it("applies free shipping from the threshold", () => {
    expect(shippingPrice(terms, 4999)).toBe(500);
    expect(shippingPrice(terms, 5000)).toBe(0);
    expect(shippingPrice({ price: 500, freeFrom: null }, 1_000_000)).toBe(500);
  });

  it("requires a choice when the product declares options — with or without variants", () => {
    expect(code(() => priceOrder(request({ lines: [{ productId: "tee", quantity: 1 }] }), catalog, terms))).toBe("selection_required");
    expect(code(() => priceOrder(request({ lines: [{ productId: "hoodie", quantity: 1 }] }), catalog, terms))).toBe("selection_required");
    expect(code(() => priceOrder(request({ lines: [{ productId: "hoodie", quantity: 1, selection: { size: "m" } }] }), catalog, terms))).toBe("selection_required");
    const ok = priceOrder(request({ lines: [{ productId: "hoodie", quantity: 1, selection: { size: "m", color: "black" } }] }), catalog, terms);
    expect(ok.lines[0]).toMatchObject({ variantId: null, variantLabel: "M · Black", unitPrice: 4000 });
  });

  it("rejects what cannot be sold", () => {
    expect(code(() => priceOrder(request({ lines: [] }), catalog, terms))).toBe("empty");
    expect(code(() => priceOrder(request({ lines: [{ productId: "nope", quantity: 1 }] }), catalog, terms))).toBe("unknown_product");
    expect(code(() => priceOrder(request({ lines: [{ productId: "tee", variantId: "nope", quantity: 1 }] }), catalog, terms))).toBe("unknown_variant");
    expect(code(() => priceOrder(request({ lines: [{ productId: "tee", variantId: "tee-m-black", quantity: 1 }] }), catalog, terms))).toBe("out_of_stock");
    expect(code(() => priceOrder(request({ lines: [{ productId: "mug", quantity: 6 }] }), catalog, terms))).toBe("out_of_stock");
    // Two lines of the same product add up against the same stock.
    expect(code(() => priceOrder(request({ lines: [{ productId: "mug", quantity: 3 }, { productId: "mug", quantity: 3 }] }), catalog, terms))).toBe("out_of_stock");
    expect(code(() => priceOrder(request({ lines: [{ productId: "mug", quantity: 0 }] }), catalog, terms))).toBe("quantity");
    expect(code(() => priceOrder(request({ lines: [{ productId: "mug", quantity: 999 }] }), catalog, terms))).toBe("quantity");
  });
});
