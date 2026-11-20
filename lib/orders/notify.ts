// What happens AFTER an order exists or a payment is confirmed: e-mails and server-side events.
// Everything here runs after the response was sent (`after()`), and nothing here may throw.

import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, paths, t, tr } from "@/i18n";
import { sendServerEvent, type UserData } from "@/lib/analytics/server";
import { needsShipping } from "@/lib/data/availability";
import type { Customer, Order, PaymentRecord } from "@/lib/data/types";
import { env } from "@/lib/env";
import { describeLine, formatPrice, formatUnitPrice } from "@/lib/format";
import { mail } from "@/lib/mail";
import { canDownload, downloadPath } from "./download";
import { signReceipt } from "./receipt";

function items(order: Order) {
  return order.lines.map((l) => ({ id: l.variantId ?? l.productId, name: l.name, price: l.unitPrice, quantity: l.quantity }));
}

/** The buyer's own link to the order: the signed receipt travels in the address. */
export function orderLink(order: Order): string {
  const e = env();
  return `${e.siteUrl}${paths.order(order.id, signReceipt(order, e.orderSecret))}`;
}

const lineText = (order: Order) => order.lines.map((l) => `- ${describeLine(l)} — ${formatUnitPrice(l.unitPrice, l.unit)}`).join("\n");

/**
 * The download links of a PAID order, one per digital line, as text for an e-mail. Empty when
 * the order is not paid: a file is never handed over before the money is confirmed.
 */
export function downloadLinks(order: Order): string {
  if (!canDownload(order)) return "";
  const e = env();
  const list = order.lines.flatMap((l, i) =>
    l.type === "digital" ? [`- ${l.name}: ${e.siteUrl}${downloadPath(order.id, i, e.orderSecret, commerce.digital.linkHours)}`] : [],
  );
  return list.length > 0 ? `\n${fill(t.mail.downloads, { hours: commerce.digital.linkHours })}\n${list.join("\n")}\n` : "";
}

export async function notifyOrderCreated(order: Order, customer: Customer, orderUrl: string, user: UserData, consent: boolean) {
  const shipping = needsShipping(order.lines)
    ? tr(commerce.shipping.methods.find((m) => m.id === order.shipping.methodId)?.label) || order.shipping.methodId
    : t.checkout.noShipping;
  const values = {
    id: order.id,
    total: formatPrice(order.total),
    url: orderUrl,
    brand: brand.name,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: [customer.address, customer.city, customer.postalCode].filter(Boolean).join(", ") || "—",
    notes: customer.notes ?? "—",
    payment: order.paymentMethod,
    shipping,
    lines: lineText(order),
  };
  const jobs: Promise<unknown>[] = [
    mail().send({ to: customer.email, subject: fill(t.mail.orderSubject, values), text: fill(t.mail.orderBody, values) }),
  ];
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (owner) {
    jobs.push(mail().send({ to: owner, subject: fill(t.mail.ownerSubject, values), text: fill(t.mail.ownerBody, values), replyTo: customer.email }));
  }
  // An order paid by hand is a CONTACT for the ad platforms, not a purchase: nobody has paid yet.
  if (consent && order.paymentMethod !== "online") {
    jobs.push(
      sendServerEvent({ name: "generate_lead", eventId: `lead-${order.id}`, value: order.total, currency: order.currency, items: items(order), url: env().siteUrl, user }),
    );
  }
  await Promise.allSettled(jobs);
}

/** The purchase, reported ONCE, from the server, when the money is confirmed. */
export async function notifyOrderPaid(order: Pick<Order, "id" | "total" | "currency"> & Partial<Order>, orderUrl: string | null, user: UserData, consent: boolean) {
  const jobs: Promise<unknown>[] = [];
  if (consent) {
    jobs.push(
      sendServerEvent({
        name: "purchase",
        eventId: order.id, // the order id IS the event id: platforms de-duplicate on it
        value: order.total,
        currency: order.currency,
        items: order.lines ? items(order as Order) : [],
        url: env().siteUrl,
        user,
      }),
    );
  }
  jobs.push(sendPaidMail(order, orderUrl, user.email ?? null));
  await Promise.allSettled(jobs);
}

/** "We received your payment" — with the download links when the order has digital products. */
export async function sendPaidMail(order: Pick<Order, "id" | "total" | "currency"> & Partial<Order>, orderUrl: string | null, email: string | null) {
  const full = order.lines && order.createdAt ? (order as Order) : null;
  const values = {
    id: order.id,
    total: formatPrice(order.total),
    url: orderUrl ?? (full ? orderLink(full) : env().siteUrl),
    brand: brand.name,
    downloads: full ? downloadLinks(full) : "",
    lines: full ? lineText(full) : "",
  };
  const jobs: Promise<unknown>[] = [];
  if (email) jobs.push(mail().send({ to: email, subject: fill(t.mail.paidSubject, values), text: fill(t.mail.paidBody, values) }));
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (owner) jobs.push(mail().send({ to: owner, subject: fill(t.mail.paidSubject, values), text: fill(t.mail.paidBody, { ...values, downloads: "" }) }));
  await Promise.allSettled(jobs);
}

/** An enquiry came in: the customer gets a copy, the owner is told to price it. */
export async function notifyQuoteRequested(order: Order, customer: Customer, orderUrl: string) {
  const line = order.lines[0];
  const values = {
    id: order.id, brand: brand.name, url: orderUrl, name: customer.name, email: customer.email, phone: customer.phone,
    lines: order.lines.map((l) => `- ${describeLine(l)}`).join("\n"), detail: line?.note ?? "—", admin: `${env().siteUrl}/admin`,
  };
  const jobs: Promise<unknown>[] = [mail().send({ to: customer.email, subject: fill(t.mail.quoteRequestSubject, values), text: fill(t.mail.quoteRequestBody, values) })];
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (owner) jobs.push(mail().send({ to: owner, subject: fill(t.mail.quoteOwnerSubject, values), text: fill(t.mail.quoteOwnerBody, values), replyTo: customer.email }));
  await Promise.allSettled(jobs);
}

/** The owner sent the price: the customer gets the signed link to see it, accept it and pay. */
export async function notifyQuoteSent(order: Order, customer: Pick<Customer, "name" | "email">): Promise<boolean> {
  const values = {
    id: order.id, brand: brand.name, url: orderLink(order), name: customer.name, total: formatPrice(order.total),
    lines: lineText(order),
    shipping: order.shipping.price > 0 ? formatPrice(order.shipping.price) : t.common.free,
  };
  return mail().send({ to: customer.email, subject: fill(t.mail.quoteSentSubject, values), text: fill(t.mail.quoteSentBody, values) });
}

/** Money arrived for a cancelled order: only the owner is told. Never a purchase event. */
export async function notifyPaymentOnCancelledOrder(payment: PaymentRecord) {
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (!owner) return;
  const values = { id: payment.orderId, total: formatPrice(payment.amount), provider: payment.provider, payment: payment.paymentId, url: `${env().siteUrl}/admin`, brand: brand.name };
  await mail().send({ to: owner, subject: fill(t.mail.cancelledPaidSubject, values), text: fill(t.mail.cancelledPaidBody, values) });
}
