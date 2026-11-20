// One schema for the checkout: the browser uses it to help (messages per field), the server uses
// it as the authority. Unknown keys are DROPPED — a `price` or `total` sent by a browser never
// gets past this point.

import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

export const customerSchema = z.object({
  name: text(120).min(2),
  email: text(160).email(),
  phone: text(40).refine((v) => v.replace(/\D/g, "").length >= 6),
  address: text(200).optional(),
  city: text(120).optional(),
  postalCode: text(20).optional(),
  notes: text(500).optional(),
});

export const lineSchema = z.object({
  productId: text(120).min(1),
  variantId: text(160).nullish(),
  selection: z.record(text(60), text(60)).optional(),
  // May be a decimal (0.75 kg). Whether it is a valid one for THIS product is decided against the
  // catalogue (minimum, step, maximum), not here.
  quantity: z.number().positive().max(1_000_000),
  /** Service only: `YYYY-MM-DDTHH:MM`, wall time of the store. */
  slot: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullish(),
});

export const orderRequestSchema = z.object({
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z.array(lineSchema).min(1).max(50),
  customer: customerSchema,
  // Ignored when nothing in the order is shipped (the server decides that from the catalogue).
  shippingMethodId: text(60).optional(),
  paymentMethod: z.enum(["whatsapp", "bank_transfer", "online"]),
  antibotToken: z.string().max(4000).optional(),
  /** Where the visit came from (UTM, click ids) and whether analytics consent was given. */
  attribution: z.record(text(40), text(300)).optional(),
});

/** An enquiry about a product without a public price. */
export const quoteRequestSchema = z.object({
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  productId: text(120).min(1),
  quantity: z.number().positive().max(1_000_000),
  detail: text(2000).min(5),
  customer: customerSchema.pick({ name: true, email: true, phone: true }),
  antibotToken: z.string().max(4000).optional(),
  attribution: z.record(text(40), text(300)).optional(),
});

export type OrderRequestBody = z.infer<typeof orderRequestSchema>;
export type CustomerField = keyof z.infer<typeof customerSchema>;
