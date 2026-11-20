import type { OrderRequest, Product } from "@/lib/data/types";

export const product = (over: Partial<Product> = {}): Product => ({
  id: "mug", slug: "mug", name: "Mug", description: "A mug.", category: "home", price: 1000, compareAtPrice: null,
  images: [{ src: "/products/mug.svg", alt: "Mug", width: 800, height: 1000 }], options: [], variants: [], stock: 5,
  featured: false, active: true, minQuantity: 1, attributes: {}, createdAt: "2026-01-01T00:00:00.000Z",
  type: "physical", unit: "u", step: 1, maxQuantity: null, service: null, digital: null, ...over,
});

export const tee = (over: Partial<Product> = {}): Product =>
  product({
    id: "tee", slug: "tee", name: "Tee", price: 2000, stock: null,
    options: [
      { id: "size", name: "Size", values: [{ id: "s", label: "S" }, { id: "m", label: "M" }] },
      { id: "color", name: "Colour", values: [{ id: "black", label: "Black" }, { id: "white", label: "White" }] },
    ],
    variants: [
      { id: "tee-s-black", options: { size: "s", color: "black" }, stock: 3 },
      { id: "tee-m-black", options: { size: "m", color: "black" }, stock: 0 },
      { id: "tee-m-white", options: { size: "m", color: "white" }, stock: null, price: 2500 },
    ],
    ...over,
  });

/** Options declared, NO variants generated: the customer still has to choose. */
export const hoodie = (over: Partial<Product> = {}): Product =>
  product({ id: "hoodie", slug: "hoodie", name: "Hoodie", price: 4000, stock: null, options: tee().options, variants: [], ...over });

export const KEY = "a".repeat(64);

export const request = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  idempotencyKey: KEY,
  lines: [{ productId: "mug", quantity: 2 }],
  customer: { name: "Ana Example", email: "ana@example.com", phone: "+00 000 000 0001" },
  shippingMethodId: "pickup",
  paymentProvider: "manual",
  paymentMethod: "bank_transfer",
  ...over,
});
