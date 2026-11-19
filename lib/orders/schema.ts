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
  quantity: z.number().int().min(1).max(999),
});

export const orderRequestSchema = z.object({
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z.array(lineSchema).min(1).max(50),
  customer: customerSchema,
  shippingMethodId: text(60).min(1),
  paymentMethod: z.enum(["whatsapp", "bank_transfer", "online"]),
  antibotToken: z.string().max(4000).optional(),
  /** Where the visit came from (UTM, click ids) and whether analytics consent was given. */
  attribution: z.record(text(40), text(300)).optional(),
});

export type OrderRequestBody = z.infer<typeof orderRequestSchema>;
export type CustomerField = keyof z.infer<typeof customerSchema>;
