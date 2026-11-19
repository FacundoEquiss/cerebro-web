// PAYMENT ADAPTER: manual (the default). No gateway and no keys: the order is registered and the
// buyer pays by bank transfer or arranges it by WhatsApp. The owner confirms the payment by hand,
// so this adapter never marks an order as paid and never reports a purchase to the ad platforms.

import { commerce } from "@/config/commerce";
import { brand } from "@/config/brand";
import type { PaymentMethod } from "@/lib/data/types";
import type { PaymentAdapter } from "./types";

export const manualAdapter: PaymentAdapter = {
  id: "manual",
  methods() {
    const methods: PaymentMethod[] = [];
    if (commerce.manualPayment.whatsapp.enabled && brand.contact.whatsapp) methods.push("whatsapp");
    if (commerce.manualPayment.bankTransfer.enabled) methods.push("bank_transfer");
    // Never leave the checkout without a way to finish.
    return methods.length > 0 ? methods : ["bank_transfer"];
  },
  async start() {
    return { type: "instructions" };
  },
  async parseWebhook() {
    return { type: "ignored" };
  },
};
