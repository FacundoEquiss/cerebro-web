import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrderRequest, Product } from "@/lib/data/types";

export const product = (over: Partial<Product> = {}): Product => ({
  id: "mug", slug: "mug", name: "Mug", description: "A mug.", category: "home", price: 1000, compareAtPrice: null,
  images: [{ src: "/products/mug.svg", alt: "Mug", width: 800, height: 1000 }], options: [], variants: [], stock: 5,
  featured: false, active: true, draft: false, minQuantity: 1, attributes: {}, createdAt: "2026-01-01T00:00:00.000Z",
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

/** A throwaway project in the state of a fresh clone (the mixed preset), whatever THIS store's files are. */
export function pristineProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const dir of ["scripts", "content", "config", "db"]) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["scripts/preset.mjs", "scripts/generate-seed.mjs"]) cpSync(file, join(root, file));
  cpSync("content/presets", join(root, "content/presets"), { recursive: true });
  const mixto = JSON.parse(readFileSync("content/presets/mixto.json", "utf8"));
  writeFileSync(join(root, "content/products.json"), JSON.stringify({ categories: mixto.categories, products: mixto.products }, null, 2));
  writeFileSync(join(root, "content/site.json"), JSON.stringify({ preset: "mixto", home: mixto.home }, null, 2));
  // The brand file of the fixtures, with the palette of the mixed preset.
  let brand = readFileSync("tests/fixtures/config/brand.ts", "utf8");
  for (const [key, value] of Object.entries(mixto.palette as Record<string, string>)) brand = brand.replace(new RegExp(`(\\b${key}:\\s*")#[0-9a-fA-F]{6}(")`), `$1${value}$2`);
  writeFileSync(join(root, "config/brand.ts"), brand);
  writeFileSync(join(root, "db/seed.sql"), "");
  return root;
}

/** The presets ship with the template; an owner may delete them once the store is theirs. */
export const HAS_PRESETS = existsSync("content/presets/mixto.json");
