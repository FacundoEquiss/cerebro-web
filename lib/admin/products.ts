// The product form of the admin panel: one schema for the browser (messages per field) and the
// server (the authority), and the helpers both share.

import { z } from "zod";
import type { Product, ProductInput, ProductOption, Variant } from "@/lib/data/types";

const id = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const money = z.number().min(0).max(1_000_000_000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const productInputSchema = z.object({
  id: id.optional(),
  slug: id,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000),
  category: z.string().trim().min(1).max(120),
  price: money,
  compareAtPrice: money.nullable(),
  stock: z.number().min(0).nullable(),
  featured: z.boolean(),
  active: z.boolean(),
  // May be a decimal: 0.25 kg.
  minQuantity: z.number().positive().max(100_000),
  type: z.enum(["physical", "digital", "service", "quote"]).default("physical"),
  unit: z.string().trim().min(1).max(12).default("u"),
  step: z.number().positive().max(100_000).default(1),
  maxQuantity: z.number().positive().max(1_000_000).nullable().default(null),
  service: z.object({
    durationMinutes: z.number().int().min(5).max(24 * 60),
    capacity: z.number().int().min(1).max(1000),
    weekly: z.record(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), z.array(z.tuple([time, time])).max(6)).nullish(),
    blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
  }).nullable().default(null),
  digital: z.object({ name: z.string().trim().min(1).max(200), file: z.string().max(300).optional() }).nullable().default(null),
  attributes: z.record(z.string().max(60), z.string().max(300)),
  images: z.array(z.object({
    src: z.string().min(1).max(600),
    // A photo without a description is invisible to screen readers and search engines.
    alt: z.string().trim().min(3).max(200),
    width: z.number().int().min(1).max(10000),
    height: z.number().int().min(1).max(10000),
    option: z.record(z.string(), z.string()).optional(),
  })).max(12),
  options: z.array(z.object({
    id,
    name: z.string().trim().min(1).max(60),
    values: z.array(z.object({ id, label: z.string().trim().min(1).max(60), swatch: z.string().max(30).optional() })).min(1).max(30),
  })).max(3),
  variants: z.array(z.object({
    id: z.string().min(1).max(160),
    options: z.record(z.string(), z.string()),
    stock: z.number().min(0).nullable(),
    price: money.nullable().optional(),
  })).max(200),
});

export type ProductForm = z.infer<typeof productInputSchema>;

/** The form as a product: what does not apply to its type is dropped, never left half-set. */
export function toProductInput(form: ProductForm): ProductInput {
  const piece = form.type === "digital" || form.type === "service";
  return {
    ...form,
    id: form.id ?? form.slug,
    // A download and an appointment are counted in whole pieces (seats).
    unit: piece ? "u" : form.unit,
    step: piece ? 1 : form.step,
    minQuantity: piece ? Math.max(1, Math.trunc(form.minQuantity)) : form.minQuantity,
    // A service has no shelf: its limit is the capacity of each slot.
    stock: form.type === "service" || form.type === "quote" ? null : form.stock,
    service: form.type === "service" ? (form.service ?? { durationMinutes: 60, capacity: 1 }) as ProductInput["service"] : null,
    digital: form.type === "digital" ? form.digital : null,
  };
}

/** "Taza de Cerámica Azul" → "taza-de-ceramica-azul". */
export function slugify(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/**
 * Every combination of the declared options, keeping the stock and price of the variants that
 * already exist. Ids are stable: `<productId>-<value>-<value>`.
 */
export function generateVariants(productId: string, options: ProductOption[], existing: Variant[]): Variant[] {
  const usable = options.filter((o) => o.values.length > 0);
  if (usable.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const option of usable) {
    combos = combos.flatMap((c) => option.values.map((v) => ({ ...c, [option.id]: v.id })));
  }
  return combos.map((combo) => {
    const previous = existing.find((v) => usable.every((o) => v.options[o.id] === combo[o.id]));
    return {
      id: previous?.id ?? `${productId}-${usable.map((o) => combo[o.id]).join("-")}`,
      options: combo,
      stock: previous ? previous.stock : 0,
      price: previous?.price ?? null,
    };
  });
}

export function emptyProduct(category: string): Product {
  return {
    id: "", slug: "", name: "", description: "", category, price: 0, compareAtPrice: null, images: [], options: [],
    variants: [], stock: 0, featured: false, active: true, minQuantity: 1, attributes: {}, createdAt: "",
    type: "physical", unit: "u", step: 1, maxQuantity: null, service: null, digital: null,
  };
}
