// PAYMENT ADAPTER: stripe (Checkout Session). The buyer is redirected to Stripe's hosted page; the
// result comes back through a SIGNED webhook. Plain `fetch`, no SDK.
// Official docs (they change — confirm before going live):
//   https://docs.stripe.com/payments/checkout  ·  https://docs.stripe.com/webhooks

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { t } from "@/i18n";
import type { PaymentRecord } from "@/lib/data/types";
import { formatQuantity, lineTotal } from "@/lib/format";
import type { PaymentAdapter } from "./types";

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;
// Currencies Stripe counts in whole units (no cents).
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export const toMinor = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
export const fromMinor = (amount: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;

async function api(path: string, form?: URLSearchParams, idempotencyKey?: string) {
  const res = await fetch(`${API}${path}`, {
    method: form ? "POST" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env().STRIPE_SECRET_KEY}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form,
  });
  if (!res.ok) throw new Error(`stripe ${path.split("?")[0]} → ${res.status}`);
  return res.json();
}

/**
 * Checks the `Stripe-Signature` header: `t=<unix>,v1=<hmac>[,v1=…]` where the HMAC-SHA256 (hex,
 * keyed with the endpoint secret) covers `<t>.<raw body>`. Old timestamps are rejected (replays).
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Date.now() / 1000): boolean {
  if (!header || !secret) return false;
  let timestamp = "";
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t" && v) timestamp = v;
    if (k === "v1" && v) candidates.push(v);
  }
  if (!timestamp || candidates.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  return candidates.some((c) => {
    const given = Buffer.from(c);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface Session {
  id: string;
  client_reference_id?: string | null;
  payment_status: string;
  payment_intent?: string | null;
  amount_total: number;
  currency: string;
  metadata?: Record<string, string>;
  customer_details?: { email?: string | null } | null;
}

function toRecord(s: Session): PaymentRecord {
  const currency = s.currency.toUpperCase();
  return {
    provider: "stripe",
    paymentId: s.payment_intent ?? s.id,
    orderId: s.client_reference_id ?? "",
    amount: fromMinor(s.amount_total, currency),
    currency,
    status: s.payment_status === "paid" ? "approved" : "pending",
  };
}

export const stripeAdapter: PaymentAdapter = {
  id: "stripe",
  methods: () => ["online"],

  async start({ order, customer, returnUrl, metadata }) {
    const form = new URLSearchParams();
    const currency = order.currency.toLowerCase();
    form.set("mode", "payment");
    form.set("client_reference_id", order.id);
    if (customer.email) form.set("customer_email", customer.email);
    // Stripe replaces {CHECKOUT_SESSION_ID}; the order page uses it to ask for the live status.
    form.set("success_url", `${returnUrl}&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", returnUrl);
    for (const [k, v] of Object.entries(metadata)) form.set(`metadata[${k}]`, v);
    // A gateway counts whole units: a line sold by weight (0.75 kg) goes as ONE item worth the line.
    const items = order.lines.map((l) => {
      const whole = Number.isInteger(l.quantity);
      const name = l.variantLabel ? `${l.name} (${l.variantLabel})` : l.name;
      return { name: whole ? name : `${name} — ${formatQuantity(l.quantity, l.unit)}`, amount: whole ? l.unitPrice : lineTotal(l), quantity: whole ? l.quantity : 1 };
    });
    if (order.shipping.price > 0) items.push({ name: t.cart.shipping, amount: order.shipping.price, quantity: 1 });
    items.forEach((item, i) => {
      form.set(`line_items[${i}][quantity]`, String(item.quantity));
      form.set(`line_items[${i}][price_data][currency]`, currency);
      form.set(`line_items[${i}][price_data][unit_amount]`, String(toMinor(item.amount, order.currency)));
      form.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    });
    // The order id makes the call idempotent: a retry returns the same session.
    const session = (await api("/checkout/sessions", form, `session-${order.id}`)) as { url: string };
    return { type: "redirect", url: session.url };
  },

  async parseWebhook(req) {
    if (!verifyStripeSignature(req.rawBody, req.headers.get("stripe-signature"), env().STRIPE_WEBHOOK_SECRET ?? "")) {
      return { type: "invalid", reason: "bad Stripe-Signature" };
    }
    const event = JSON.parse(req.rawBody) as { type: string; data: { object: Session } };
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return { type: "ignored" };
    }
    const session = event.data.object;
    if (!session.client_reference_id) return { type: "ignored" };
    return {
      type: "payment",
      payment: toRecord(session),
      metadata: session.metadata ?? {},
      email: session.customer_details?.email ?? null,
    };
  },

  async lookup(orderId, params) {
    const sessionId = params.session_id;
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
    const session = (await api(`/checkout/sessions/${sessionId}`)) as Session;
    return session.client_reference_id === orderId ? toRecord(session) : null;
  },
};
