// What happens AFTER an order exists or a payment is confirmed: e-mails and server-side events.
// Everything here runs after the response was sent (`after()`), and nothing here may throw.

import { brand } from "@/config/brand";
import { commerce } from "@/config/commerce";
import { fill, t, tr } from "@/i18n";
import { sendServerEvent, type UserData } from "@/lib/analytics/server";
import type { Customer, Order, PaymentRecord } from "@/lib/data/types";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/format";
import { mail } from "@/lib/mail";

function items(order: Order) {
  return order.lines.map((l) => ({ id: l.variantId ?? l.productId, name: l.name, price: l.unitPrice, quantity: l.quantity }));
}

export async function notifyOrderCreated(order: Order, customer: Customer, orderUrl: string, user: UserData, consent: boolean) {
  const shipping = tr(commerce.shipping.methods.find((m) => m.id === order.shipping.methodId)?.label) || order.shipping.methodId;
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
    lines: order.lines.map((l) => `- ${l.quantity} × ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""} — ${formatPrice(l.unitPrice)}`).join("\n"),
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
export async function notifyOrderPaid(order: Pick<Order, "id" | "total" | "currency"> & { lines?: Order["lines"] }, orderUrl: string | null, user: UserData, consent: boolean) {
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
  const values = { id: order.id, total: formatPrice(order.total), url: orderUrl ?? env().siteUrl, brand: brand.name };
  if (user.email) jobs.push(mail().send({ to: user.email, subject: fill(t.mail.paidSubject, values), text: fill(t.mail.paidBody, values) }));
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (owner) jobs.push(mail().send({ to: owner, subject: fill(t.mail.paidSubject, values), text: fill(t.mail.paidBody, values) }));
  await Promise.allSettled(jobs);
}

/** Money arrived for a cancelled order: only the owner is told. Never a purchase event. */
export async function notifyPaymentOnCancelledOrder(payment: PaymentRecord) {
  const owner = env().ORDER_NOTIFY_EMAIL;
  if (!owner) return;
  const values = { id: payment.orderId, total: formatPrice(payment.amount), provider: payment.provider, payment: payment.paymentId, url: `${env().siteUrl}/admin`, brand: brand.name };
  await mail().send({ to: owner, subject: fill(t.mail.cancelledPaidSubject, values), text: fill(t.mail.cancelledPaidBody, values) });
}
