// QUOTES, as the admin panel handles them: the owner types a price per line and the shipping,
// saves, and SENDS. Until it is sent the customer cannot accept or pay it; what they can accept
// is always exactly what was last sent (see `accept_quote` in db/schema.sql).

import { data } from "@/lib/data";
import { AdminError, type AdminOrder, type QuoteAnswer } from "@/lib/data/types";
import { notifyQuoteSent, orderLink } from "@/lib/orders/notify";

export async function priceQuote(id: string, answer: QuoteAnswer, actor: string): Promise<AdminOrder> {
  if (answer.prices.some((p) => !Number.isFinite(p) || p < 0) || !Number.isFinite(answer.shipping) || answer.shipping < 0) throw new AdminError("invalid");
  return (await data()).setQuote(id, answer, actor);
}

/** The customer's own signed link to the quote — what the e-mail carries. Admin only. */
export async function quoteLink(id: string): Promise<string | null> {
  const stored = await (await data()).getOrder(id);
  return stored?.quote ? orderLink(stored) : null;
}

export interface SentQuote {
  order: AdminOrder;
  /** The customer's link: the owner can also deliver it by hand. */
  link: string | null;
  /** Whether the e-mail REALLY went out. False with no mail provider: the panel must not claim it. */
  mailed: boolean;
}

/**
 * Saves the prices and sends the quote in one step. The e-mail is awaited on purpose: the owner
 * has to know whether the customer was told, and if not, pass the link another way.
 */
export async function sendQuote(id: string, answer: QuoteAnswer | null, actor: string): Promise<SentQuote> {
  const adapter = await data();
  if (answer) await priceQuote(id, answer, actor);
  const order = await adapter.sendQuote(id, actor);
  const stored = await adapter.getOrder(id);
  let mailed = false;
  try {
    mailed = stored ? await notifyQuoteSent(stored, order.customer) : false;
  } catch (e) {
    console.error("[quote-mail]", e instanceof Error ? e.message : e);
  }
  return { order, link: stored ? orderLink(stored) : null, mailed };
}
