// The totals of an enquiry once the owner typed a price per line and the shipping. Pure and free
// of server code: the admin panel previews with it, the json adapter saves with it, and SQL
// (`set_quote`) does the same sum — to the cent (lib/decimal.ts).

import { multiplyMoney, roundCents } from "@/lib/decimal";

export function quoteTotals(lines: { quantity: number }[], prices: number[], shipping: number): { subtotal: number; shipping: number; total: number } {
  const subtotal = roundCents(lines.reduce((sum, l, i) => sum + multiplyMoney(roundCents(Math.max(0, prices[i] ?? 0)), l.quantity), 0));
  const ship = roundCents(Math.max(0, shipping));
  return { subtotal, shipping: ship, total: roundCents(subtotal + ship) };
}
