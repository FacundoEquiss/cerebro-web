// CREDITING A PAYMENT — the same path for every gateway, after its webhook was verified.
//
//   1. Compare what was PAID with the official total. Not equal → credit nothing, shout in the
//      log, a person resolves it.
//   2. Register the payment once. A second notification of the same payment changes nothing.
//   3. Only the first time: e-mails and the `purchase` event.

import { data } from "@/lib/data";
import type { PaymentRecord } from "@/lib/data/types";
import { env } from "@/lib/env";
import { notifyOrderPaid, notifyPaymentOnCancelledOrder } from "@/lib/orders/notify";
import { readSeal } from "@/lib/orders/receipt";

export type CreditOutcome = "credited" | "duplicate" | "pending" | "mismatch" | "unknown_order" | "cancelled_order";

/** Pure: does a payment equal the sealed total? */
export function matchesSeal(payment: PaymentRecord, seal: string | null | undefined, secret: string): boolean {
  const sealed = readSeal(payment.orderId, seal, secret);
  if (!sealed) return false;
  return sealed.currency.toUpperCase() === payment.currency.toUpperCase() && Math.abs(sealed.total - payment.amount) < 0.005;
}

export async function creditPayment(payment: PaymentRecord, metadata: Record<string, string>, email: string | null): Promise<CreditOutcome> {
  const adapter = await data();
  // The seal travelled through the gateway's metadata: it proves the total WE quoted.
  const sealOk = matchesSeal(payment, metadata.seal, env().orderSecret);
  const result = await adapter.recordPayment(payment);
  const matches = result.amountMatches ?? sealOk;

  if (adapter.storesOrders && result.amountMatches === null) {
    console.error(`[payment] ${payment.provider} ${payment.paymentId}: order ${payment.orderId} not found`);
    return "unknown_order";
  }
  if (!matches) {
    // Money came in for an amount that is not the order's: never mark as paid automatically.
    console.error(`[payment-mismatch] ${payment.provider} ${payment.paymentId} order ${payment.orderId}: paid ${payment.amount} ${payment.currency}`);
    return "mismatch";
  }
  if (payment.status !== "approved") return "pending";
  if (!result.firstTime) return "duplicate";
  if (result.orderStatus === "cancelled") {
    // Money for an order that was cancelled (it expired, or the owner cancelled it while the
    // buyer was paying). It is NOT a sale: nothing is credited and no purchase is reported. The
    // adapter wrote it to the order's timeline; here the owner is told, so a person decides.
    console.error(`[payment-on-cancelled-order] ${payment.provider} ${payment.paymentId} order ${payment.orderId}: review or refund`);
    await notifyPaymentOnCancelledOrder(payment);
    return "cancelled_order";
  }

  console.info(`[payment-credited] ${payment.provider} ${payment.paymentId} order ${payment.orderId}`);
  const order = (await adapter.getOrder(payment.orderId)) ?? { id: payment.orderId, total: payment.amount, currency: payment.currency };
  // The purchase is reported ONCE per order, whoever confirms it (this webhook or the admin panel).
  const first = await adapter.claimPurchaseEvent(payment.orderId);
  await notifyOrderPaid(
    order,
    null,
    { email, fbp: metadata.fbp, fbc: metadata.fbc, gaClientId: metadata.ga_client_id },
    first && metadata.consent === "granted",
  );
  return "credited";
}
