// The shapes every payment adapter speaks. See docs/adapters.md.

import type { Customer, Order, PaymentMethod, PaymentRecord } from "@/lib/data/types";

export interface StartContext {
  order: Order;
  customer: Customer;
  /** Absolute URL of the order page, receipt included: where the gateway sends the buyer back. */
  returnUrl: string;
  /** Absolute URL of this adapter's webhook. */
  webhookUrl: string;
  /** Small strings to get back in the webhook (the total seal, attribution ids…). */
  metadata: Record<string, string>;
}

export type StartResult =
  /** Nothing to pay online: the order page shows how to pay (transfer, message…). */
  | { type: "instructions" }
  /** Send the buyer to the gateway's hosted checkout. */
  | { type: "redirect"; url: string };

export interface WebhookRequest {
  rawBody: string;
  headers: Headers;
  url: URL;
}

export type WebhookResult =
  /** Bad or missing signature. Answer 401 and credit NOTHING. */
  | { type: "invalid"; reason: string }
  /** A valid notification that is not about a payment we care about. Answer 200. */
  | { type: "ignored" }
  | { type: "payment"; payment: PaymentRecord; metadata: Record<string, string>; email: string | null };

export interface PaymentAdapter {
  readonly id: string;
  /** Ways to pay this adapter offers in the checkout, in order. */
  methods(): PaymentMethod[];
  start(ctx: StartContext): Promise<StartResult>;
  /** Verifies the signature FIRST, then asks the gateway's API what really happened. */
  parseWebhook(req: WebhookRequest): Promise<WebhookResult>;
  /** Live status of an order's payment, for the order page. `null` = nothing known. */
  lookup?(orderId: string, params: Record<string, string | undefined>): Promise<PaymentRecord | null>;
}
