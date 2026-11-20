// QUOTES, as the admin panel handles them: the owner types a price per line and the shipping,
// saves, and SENDS. Until it is sent the customer cannot accept or pay it; what they can accept
// is always exactly what was last sent (see `accept_quote` in db/schema.sql).

import { data } from "@/lib/data";
import { AdminError, type AdminOrder, type QuoteAnswer } from "@/lib/data/types";
import { notifyQuoteSent } from "@/lib/orders/notify";

export async function priceQuote(id: string, answer: QuoteAnswer, actor: string): Promise<AdminOrder> {
  if (answer.prices.some((p) => !Number.isFinite(p) || p < 0) || !Number.isFinite(answer.shipping) || answer.shipping < 0) throw new AdminError("invalid");
  return (await data()).setQuote(id, answer, actor);
}

/** Saves the prices and sends the quote in one step; the customer gets the e-mail with the link. */
export async function sendQuote(id: string, answer: QuoteAnswer | null, actor: string): Promise<AdminOrder> {
  const adapter = await data();
  if (answer) await priceQuote(id, answer, actor);
  const order = await adapter.sendQuote(id, actor);
  const stored = await adapter.getOrder(id);
  if (stored) void notifyQuoteSent(stored, order.customer).catch((e) => console.error("[quote-mail]", e instanceof Error ? e.message : e));
  return order;
}
