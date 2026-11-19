// PAYMENT ADAPTER: mercadopago (Checkout Pro). The buyer is redirected to the gateway's hosted
// checkout; the result comes back through a SIGNED webhook. Plain `fetch`, no SDK.
// Official docs (they change — confirm before going live):
//   https://www.mercadopago.com/developers/en/docs/checkout-pro/overview
//   https://www.mercadopago.com/developers/en/docs/your-integrations/notifications/webhooks

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { fill, t } from "@/i18n";
import type { PaymentRecord } from "@/lib/data/types";
import type { PaymentAdapter, WebhookRequest } from "./types";

const API = "https://api.mercadopago.com";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${env().MERCADOPAGO_ACCESS_TOKEN}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`mercadopago ${path.split("?")[0]} → ${res.status}`);
  return res.json();
}

/**
 * Checks the `x-signature` header: `ts=<ts>,v1=<hmac>` where the HMAC-SHA256 (hex, keyed with the
 * webhook secret) covers `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 */
export function verifyMercadoPagoSignature(req: WebhookRequest, secret: string): boolean {
  const parts = Object.fromEntries(
    (req.headers.get("x-signature") ?? "").split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !secret) return false;
  let dataId = req.url.searchParams.get("data.id") ?? "";
  if (!dataId) {
    try {
      dataId = String((JSON.parse(req.rawBody) as { data?: { id?: unknown } }).data?.id ?? "");
    } catch {}
  }
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  const manifest = `id:${dataId};request-id:${req.headers.get("x-request-id") ?? ""};ts:${ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const given = Buffer.from(v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface MpPayment {
  id: number | string;
  status: string;
  external_reference?: string;
  transaction_amount: number;
  currency_id: string;
  metadata?: Record<string, string>;
  payer?: { email?: string };
}

function toRecord(p: MpPayment): PaymentRecord {
  return {
    provider: "mercadopago",
    paymentId: String(p.id),
    orderId: p.external_reference ?? "",
    amount: Number(p.transaction_amount),
    currency: p.currency_id,
    status: p.status === "approved" ? "approved" : p.status === "rejected" || p.status === "cancelled" ? "rejected" : "pending",
  };
}

export const mercadopagoAdapter: PaymentAdapter = {
  id: "mercadopago",
  methods: () => ["online"],

  async start({ order, customer, returnUrl, webhookUrl, metadata }) {
    const items = order.lines.map((l) => ({
      id: l.variantId ?? l.productId,
      title: l.variantLabel ? `${l.name} (${l.variantLabel})` : l.name,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      currency_id: order.currency,
    }));
    if (order.shipping.price > 0) {
      items.push({ id: "shipping", title: t.cart.shipping, quantity: 1, unit_price: order.shipping.price, currency_id: order.currency });
    }
    const https = returnUrl.startsWith("https://");
    const preference = await api("/checkout/preferences", {
      method: "POST",
      // The order id makes the call idempotent: a retry does not create a second preference.
      headers: { "X-Idempotency-Key": order.id },
      body: JSON.stringify({
        items,
        external_reference: order.id,
        statement_descriptor: fill("{id}", { id: order.id }),
        ...(customer.email ? { payer: { email: customer.email, name: customer.name } } : {}),
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        // `auto_return` is only accepted with public https URLs.
        ...(https ? { auto_return: "approved", notification_url: webhookUrl } : {}),
        metadata,
      }),
    });
    return { type: "redirect", url: String((preference as { init_point: string }).init_point) };
  },

  async parseWebhook(req) {
    if (!verifyMercadoPagoSignature(req, env().MERCADOPAGO_WEBHOOK_SECRET ?? "")) {
      return { type: "invalid", reason: "bad x-signature" };
    }
    let body: { type?: string; data?: { id?: string | number } };
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      return { type: "ignored" };
    }
    if (body.type !== "payment" || !body.data?.id) return { type: "ignored" };
    // The notification only says "something changed": the truth is asked to the API.
    const payment = (await api(`/v1/payments/${encodeURIComponent(String(body.data.id))}`)) as MpPayment;
    if (!payment.external_reference) return { type: "ignored" };
    return { type: "payment", payment: toRecord(payment), metadata: payment.metadata ?? {}, email: payment.payer?.email ?? null };
  },

  async lookup(orderId) {
    const found = (await api(
      `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc&limit=5`,
    )) as { results?: MpPayment[] };
    const list = (found.results ?? []).filter((p) => p.external_reference === orderId).map(toRecord);
    return list.find((p) => p.status === "approved") ?? list[0] ?? null;
  },
};
